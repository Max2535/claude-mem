import { describe, it, expect } from 'bun:test';
import {
  areaPath,
  buildPlot,
  coverageNotes,
  formatBucketLabel,
  formatRatio,
  formatTokens,
  formatUsd,
  isEmptyPlot,
  linePath,
  nearestIndex,
  tickIndices,
} from '../../src/ui/viewer/utils/tokenBurn.js';
import type { TokenBurnBucket, TokenBurnResponse } from '../../src/ui/viewer/types.js';

function totals(billable: number, cacheRead = 0) {
  return {
    inputTokens: billable, cacheCreationTokens: 0, cacheReadTokens: cacheRead,
    outputTokens: 0, billableTokens: billable, totalTokens: billable + cacheRead,
    costUsd: null, events: billable > 0 ? 1 : 0,
  };
}

function bucket(day: string, plugin: number, user: number, cacheRead = 0): TokenBurnBucket {
  return { bucket: day, plugin: totals(plugin, cacheRead), user: totals(user) };
}

describe('buildPlot', () => {
  const buckets = [bucket('2026-06-01', 100, 400), bucket('2026-06-02', 0, 200), bucket('2026-06-03', 50, 0)];

  it('keeps the two series separate and in order', () => {
    const plot = buildPlot(buckets, 'billableTokens', 300, 100);
    expect(plot.series.map(s => s.key)).toEqual(['plugin', 'user']);
    expect(plot.series[0].points.map(p => p.value)).toEqual([100, 0, 50]);
    expect(plot.series[1].points.map(p => p.value)).toEqual([400, 200, 0]);
  });

  // A truncated baseline makes a 3% change look like a doubling. This chart
  // answers "how much", so the scale has to start at zero.
  it('scales from zero, with headroom above the peak', () => {
    const plot = buildPlot(buckets, 'billableTokens', 300, 100);
    expect(plot.yMax).toBeCloseTo(440);
    const zeroPoint = plot.series[0].points[1];
    expect(zeroPoint.y).toBe(100);
  });

  it('spreads the buckets across the full width, first to last', () => {
    const plot = buildPlot(buckets, 'billableTokens', 300, 100);
    expect(plot.series[0].points[0].x).toBe(0);
    expect(plot.series[0].points[2].x).toBe(300);
  });

  it('survives a window where nothing was spent', () => {
    const plot = buildPlot([bucket('2026-06-01', 0, 0)], 'billableTokens', 300, 100);
    expect(Number.isFinite(plot.series[0].points[0].y)).toBe(true);
    expect(plot.yMax).toBeGreaterThan(0);
  });

  it('draws a quiet day as zero rather than skipping it', () => {
    const plot = buildPlot(buckets, 'billableTokens', 300, 100);
    expect(plot.series[0].points.length).toBe(3);
    expect(plot.series[0].points[1].value).toBe(0);
  });

  it('follows the chosen metric, so cache reads only appear when asked for', () => {
    const withCache = [bucket('2026-06-01', 100, 0, 9000)];
    expect(buildPlot(withCache, 'billableTokens', 100, 100).series[0].points[0].value).toBe(100);
    expect(buildPlot(withCache, 'totalTokens', 100, 100).series[0].points[0].value).toBe(9100);
  });
});

describe('linePath / areaPath', () => {
  // A spline between two daily samples draws spend on days that did not have
  // it, and a reader cannot tell the invented part from the measured part.
  it('uses straight segments only, never a curve command', () => {
    const plot = buildPlot([bucket('a', 1, 1), bucket('b', 2, 2), bucket('c', 3, 3)], 'billableTokens', 300, 100);
    const d = linePath(plot.series[0].points);
    expect(d).not.toMatch(/[CSQTA]/);
    expect(d.startsWith('M ')).toBe(true);
  });

  it('closes the area down to the baseline', () => {
    const plot = buildPlot([bucket('a', 1, 1), bucket('b', 2, 2)], 'billableTokens', 300, 100);
    const d = areaPath(plot.series[0].points, 100);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('L 0 100');
  });

  it('gives a single sample enough width to be visible', () => {
    const plot = buildPlot([bucket('a', 5, 5)], 'billableTokens', 300, 100);
    expect(linePath(plot.series[0].points)).toContain('L');
  });

  it('returns nothing for nothing', () => {
    expect(linePath([])).toBe('');
    expect(areaPath([], 100)).toBe('');
  });
});

describe('nearestIndex', () => {
  it('snaps to the closest bucket', () => {
    expect(nearestIndex(0, 3, 300)).toBe(0);
    expect(nearestIndex(140, 3, 300)).toBe(1);
    expect(nearestIndex(300, 3, 300)).toBe(2);
  });

  it('clamps rather than running off either end', () => {
    expect(nearestIndex(-50, 3, 300)).toBe(0);
    expect(nearestIndex(9999, 3, 300)).toBe(2);
  });

  it('handles degenerate inputs', () => {
    expect(nearestIndex(10, 0, 300)).toBe(-1);
    expect(nearestIndex(10, 1, 300)).toBe(0);
  });
});

describe('tickIndices', () => {
  // The right edge is "now"; an axis whose last label is stale misreads the
  // whole chart.
  it('always ends on the newest bucket', () => {
    for (const count of [7, 30, 90, 365]) {
      expect(tickIndices(count).at(-1)).toBe(count - 1);
    }
  });

  it('labels every bucket when there are few enough', () => {
    expect(tickIndices(4)).toEqual([0, 1, 2, 3]);
  });

  it('stays within the requested tick budget', () => {
    expect(tickIndices(365).length).toBeLessThanOrEqual(6);
  });

  it('is empty for an empty window', () => {
    expect(tickIndices(0)).toEqual([]);
  });
});

describe('formatting', () => {
  it('compacts token counts without lying about small ones', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1284)).toBe('1,284');
    expect(formatTokens(12904)).toBe('12.9K');
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(2_400_000_000)).toBe('2.40B');
  });

  // Claiming an unpriced spend was free is worse than admitting it is unknown.
  it('shows an unreported cost as a dash, never as zero', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('shows an undefined ratio as a dash', () => {
    expect(formatRatio(null)).toBe('—');
    expect(formatRatio(0.25)).toBe('25%');
    expect(formatRatio(0.043)).toBe('4.3%');
  });

  it('drops the year from an axis label but survives a malformed one', () => {
    expect(formatBucketLabel('2026-06-03')).not.toContain('2026');
    expect(formatBucketLabel('nonsense')).toBe('nonsense');
  });
});

describe('isEmptyPlot', () => {
  it('is empty only when both series are flat at zero', () => {
    expect(isEmptyPlot([bucket('a', 0, 0)], 'billableTokens')).toBe(true);
    expect(isEmptyPlot([bucket('a', 0, 1)], 'billableTokens')).toBe(false);
  });

  it('reads a cache-read-only day as empty on the billable metric but not the total', () => {
    const cacheOnly = [bucket('a', 0, 0, 5000)];
    expect(isEmptyPlot(cacheOnly, 'billableTokens')).toBe(true);
    expect(isEmptyPlot(cacheOnly, 'totalTokens')).toBe(false);
  });
});

describe('coverageNotes', () => {
  function response(overrides: Partial<TokenBurnResponse> = {}): TokenBurnResponse {
    return {
      bucket: 'day', days: 30, buckets: [],
      totals: { plugin: totals(0), user: totals(0), overheadRatio: null },
      userCaptureEnabled: true, platformsCovered: ['claude'], since: '2026-06-01',
      ...overrides,
    };
  }

  it('says nothing at all when there is no data to describe', () => {
    expect(coverageNotes(null)).toEqual([]);
  });

  // "Capture is off" and "you spent nothing" look identical in the data and
  // must never look identical on screen.
  it('distinguishes a disabled series from an empty one', () => {
    const off = coverageNotes(response({ userCaptureEnabled: false })).join(' ');
    expect(off).toContain('capture is off');
    expect(off).toContain('CLAUDE_MEM_TOKEN_BURN_CAPTURE');
    expect(coverageNotes(response()).join(' ')).not.toContain('capture is off');
  });

  it('always discloses that session cost is unavailable', () => {
    expect(coverageNotes(response()).join(' ')).toContain('no price');
  });

  it('names the platforms it cannot read', () => {
    expect(coverageNotes(response()).join(' ')).toContain('Codex');
  });

  it('says history starts at install rather than implying a quiet past', () => {
    expect(coverageNotes(response()).join(' ')).toContain('History starts');
    expect(coverageNotes(response({ since: null })).join(' ')).toContain('Nothing recorded yet');
  });
});

import { normalizePlatformSource } from '../../../../shared/platform-source.js';
import { logger } from '../../../../utils/logger.js';
import type { ObservationSearchResult, SourceCoverage } from '../types.js';

function countBySource(rows: ObservationSearchResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const source = normalizePlatformSource(row.platform_source);
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

/**
 * `total` is the per-source COUNT of everything the filter matches, which the
 * caller reads from SQLite rather than from the rows it fetched — the index is
 * capped at maxIndexRows, so its own length can never be the denominator. When
 * it is omitted the index is the whole filtered set by definition, and nothing
 * was truncated.
 */
export function computeSourceCoverage(
  indexed: ObservationSearchResult[],
  matched: ObservationSearchResult[],
  total?: Record<string, number>
): SourceCoverage {
  const indexedCounts = countBySource(indexed);
  const totalCounts = total ?? { ...indexedCounts };
  const truncated: Record<string, boolean> = {};
  for (const source of Object.keys(totalCounts)) {
    truncated[source] = totalCounts[source] > (indexedCounts[source] ?? 0);
  }
  const coverage = {
    indexed: indexedCounts,
    matched: countBySource(matched),
    total: totalCounts,
    truncated,
  };
  // A source that is indexed but never matched is the signature of a walk that
  // is silently ignoring a whole platform — worth seeing in the log. So is a
  // source the walk only ever saw a slice of.
  logger.debug('SEARCH', 'computeSourceCoverage: source coverage', {
    indexed: coverage.indexed,
    matched: coverage.matched,
    total: coverage.total,
    truncated: coverage.truncated,
  });
  return coverage;
}

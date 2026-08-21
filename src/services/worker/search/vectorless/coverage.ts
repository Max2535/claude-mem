import { normalizePlatformSource } from '../../../../shared/platform-source.js';
import type { ObservationSearchResult, SourceCoverage } from '../types.js';

function countBySource(rows: ObservationSearchResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    // platform_source is COALESCE'd into SessionSearch SQL results but absent from ObservationRow.
    const source = normalizePlatformSource((row as { platform_source?: string }).platform_source);
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

export function computeSourceCoverage(
  indexed: ObservationSearchResult[],
  matched: ObservationSearchResult[]
): SourceCoverage {
  return { indexed: countBySource(indexed), matched: countBySource(matched) };
}

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

export function computeSourceCoverage(
  indexed: ObservationSearchResult[],
  matched: ObservationSearchResult[]
): SourceCoverage {
  const coverage = { indexed: countBySource(indexed), matched: countBySource(matched) };
  // A source that is indexed but never matched is the signature of a walk that
  // is silently ignoring a whole platform — worth seeing in the log.
  logger.debug('SEARCH', 'computeSourceCoverage: source coverage', {
    indexed: coverage.indexed,
    matched: coverage.matched,
  });
  return coverage;
}

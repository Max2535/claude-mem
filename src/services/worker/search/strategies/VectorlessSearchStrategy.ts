import type { SessionSearch } from '../../../sqlite/SessionSearch.js';
import type { StrategySearchOptions, StrategySearchResult, ObservationSearchResult } from '../types.js';
import { SEARCH_CONSTANTS } from '../types.js';
import { buildDayIndex, renderDayIndex, renderObservationIndex, dayOf } from '../vectorless/IndexBuilder.js';
import { TraversalAgent, type LlmFn } from '../vectorless/TraversalAgent.js';
import { computeSourceCoverage } from '../vectorless/coverage.js';
import { logger } from '../../../../utils/logger.js';

export interface VectorlessConfig {
  maxIndexRows: number;
  maxDays: number;
}

export class VectorlessSearchStrategy {
  constructor(
    private sessionSearch: SessionSearch,
    private llm: LlmFn,
    private config: VectorlessConfig
  ) {}

  async search(options: StrategySearchOptions): Promise<StrategySearchResult> {
    const {
      query,
      limit = SEARCH_CONSTANTS.DEFAULT_LIMIT,
      project,
      platformSource,
      dateRange,
    } = options;

    // The filters the index is built from. Reused verbatim for the denominator
    // below so the two cannot describe different sets.
    const indexFilters = {
      project,
      platformSource,
      dateRange,
      // A temporal_search may carry only a query; the walk still wants the
      // newest maxIndexRows rows rather than being rejected as unfiltered.
      allowUnfiltered: true,
      // Without this the index spends its maxIndexRows budget on claude-mem's
      // own compression sessions, and the traversal can hand them back as
      // results — a leak no other observation reader has.
      excludeObserverSessions: true,
    };

    // Index is rebuilt from SQLite per query — nothing persisted, so it cannot go stale.
    const indexRows: ObservationSearchResult[] = this.sessionSearch.searchObservations(undefined, {
      ...indexFilters,
      limit: this.config.maxIndexRows,
      orderBy: 'date_desc',
    });

    // The denominator the index was cut from. A COUNT, so the cap cannot hide
    // behind it: on a 6,000-row database a 500-row index is 8% of memory, and
    // a caller must be able to tell "not there" from "not in the 8% I read".
    const totalBySource = this.sessionSearch.countObservationsBySource(indexFilters);

    const empty: StrategySearchResult = {
      results: { observations: [], sessions: [], prompts: [] },
      usedChroma: false,
      strategy: 'vectorless',
      coverage: computeSourceCoverage(indexRows, [], totalBySource),
      traversal: { rounds: 0, daysWalked: [], sessionsWalked: [], indexRows: indexRows.length },
    };
    if (!query || indexRows.length === 0) return empty;

    const agent = new TraversalAgent(this.llm);
    const days = buildDayIndex(indexRows);

    let rounds: number;
    let walkedDays: string[];
    let candidates: ObservationSearchResult[];
    if (days.length > this.config.maxDays) {
      rounds = 2;
      walkedDays = await agent.selectDays(query, renderDayIndex(days), this.config.maxDays);
      const daySet = new Set(walkedDays);
      candidates = indexRows.filter(r => daySet.has(dayOf(r)));
    } else {
      rounds = 1;
      walkedDays = days.map(d => d.day);
      candidates = indexRows;
    }

    if (candidates.length === 0) {
      logger.debug('SEARCH', 'VectorlessSearchStrategy: day selection produced no candidates', {});
      return { ...empty, traversal: { rounds, daysWalked: walkedDays, sessionsWalked: [], indexRows: indexRows.length } };
    }

    const ids = await agent.selectObservations(query, renderObservationIndex(candidates), limit);
    const byId = new Map(candidates.map(r => [r.id, r]));
    const matched = ids.map(id => byId.get(id)).filter((r): r is ObservationSearchResult => r !== undefined);

    return {
      results: { observations: matched, sessions: [], prompts: [] },
      usedChroma: false,
      strategy: 'vectorless',
      coverage: computeSourceCoverage(indexRows, matched, totalBySource),
      traversal: {
        rounds,
        daysWalked: walkedDays,
        sessionsWalked: [...new Set(matched.map(r => r.memory_session_id))],
        indexRows: indexRows.length,
      },
    };
  }
}

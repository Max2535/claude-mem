
import type { ObservationSearchResult, SessionSummarySearchResult, UserPromptSearchResult, SearchOptions, DateRange } from '../../sqlite/types.js';

export type { ObservationSearchResult, SessionSummarySearchResult, UserPromptSearchResult, SearchOptions, DateRange };

export const SEARCH_CONSTANTS = {
  RECENCY_WINDOW_MS: 90 * 24 * 60 * 60 * 1000,
  DEFAULT_LIMIT: 20,
  CHROMA_BATCH_SIZE: 100
} as const;

export type ChromaDocType = 'observation' | 'session_summary' | 'user_prompt';

export interface ChromaMetadata {
  sqlite_id: number;
  doc_type: ChromaDocType;
  memory_session_id: string;
  project: string;
  platform_source?: string;
  created_at_epoch: number;
  type?: string;
  title?: string;
  subtitle?: string;
  concepts?: string;
  files_read?: string;
  files_modified?: string;
  field_type?: string;
  prompt_number?: number;
}

export type SearchResult = ObservationSearchResult | SessionSummarySearchResult | UserPromptSearchResult;

export interface SearchResults {
  observations: ObservationSearchResult[];
  sessions: SessionSummarySearchResult[];
  prompts: UserPromptSearchResult[];
}

export interface ExtendedSearchOptions extends SearchOptions {
  searchType?: 'observations' | 'sessions' | 'prompts' | 'all';
  obsType?: string | string[];
  concepts?: string | string[];
  files?: string | string[];
  format?: 'text' | 'json';
}

export type SearchStrategyHint = 'chroma' | 'sqlite' | 'hybrid' | 'vectorless' | 'auto';

export interface StrategySearchOptions extends ExtendedSearchOptions {
  query?: string;
  strategyHint?: SearchStrategyHint;
}

export interface SourceCoverage {
  indexed: Record<string, number>;
  matched: Record<string, number>;
  /**
   * Rows matching the caller's filter BEFORE maxIndexRows capped the index —
   * a COUNT query, never the length of a fetched array. Without it "no match"
   * and "no match in the 8% of memory that was searched" read identically.
   */
  total: Record<string, number>;
  /** Per source: the filter matches more rows than the index could hold. */
  truncated: Record<string, boolean>;
}

export interface TraversalTrace {
  rounds: number;
  daysWalked: string[];
  sessionsWalked: string[];
  indexRows: number;
}

export interface StrategySearchResult {
  results: SearchResults;
  usedChroma: boolean;
  strategy: SearchStrategyHint;
  coverage?: SourceCoverage;
  traversal?: TraversalTrace;
}

export interface CombinedResult {
  type: 'observation' | 'session' | 'prompt';
  data: SearchResult;
  epoch: number;
  created_at: string;
}

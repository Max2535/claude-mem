
export interface ObservationRow {
  id: number;
  memory_session_id: string;
  project: string;
  text: string | null;
  type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change';
  title: string | null;
  subtitle: string | null;
  facts: string | null; 
  narrative: string | null;
  concepts: string | null; 
  files_read: string | null; 
  files_modified: string | null; 
  prompt_number: number | null;
  discovery_tokens: number; 
  created_at: string;
  created_at_epoch: number;
}

export interface SessionSummaryRow {
  id: number;
  memory_session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null; 
  files_edited: string | null; 
  notes: string | null;
  prompt_number: number | null;
  discovery_tokens: number; 
  created_at: string;
  created_at_epoch: number;
}

export interface UserPromptRow {
  id: number;
  session_db_id?: number | null;
  content_session_id: string;
  prompt_number: number;
  prompt_text: string;
  created_at: string;
  created_at_epoch: number;
}

export interface DateRange {
  start?: string | number; 
  end?: string | number;   
}

export interface SearchFilters {
  project?: string;
  platformSource?: string;
  type?: ObservationRow['type'] | ObservationRow['type'][];
  concepts?: string | string[];
  files?: string | string[];
  dateRange?: DateRange;
}

export interface SearchOptions extends SearchFilters {
  limit?: number;
  offset?: number;
  orderBy?: 'relevance' | 'date_desc' | 'date_asc';
  isFolder?: boolean;
  // Opt out of the filter-only guard for callers that deliberately want the
  // newest N rows with no filters — the vectorless index walk builds its index
  // that way and bounds the scan with `limit`. Accidental unfiltered searches
  // still throw.
  //
  // Internal only: SearchManager.normalizeParams strips this (and
  // excludeObserverSessions) off caller-supplied args, so an HTTP or MCP client
  // cannot hand itself an unfiltered full-table read.
  allowUnfiltered?: boolean;
  // Drop claude-mem's own compression-agent sessions from the results. Every
  // other observation reader does this (PaginationHelper.ts:87 and its three
  // siblings) — they are the tool's internal bookkeeping, not the user's work.
  // Not a SearchFilter: it must not satisfy the unfiltered guard, since a scan
  // of every project but one is still a scan of every project.
  excludeObserverSessions?: boolean;
}

export interface ObservationSearchResult extends ObservationRow {
  rank?: number; 
  score?: number; 
  /**
   * The owning sdk_session's platform_source, projected by every observation
   * SELECT in SessionSearch. Optional because rows built by other readers (or
   * by tests) may not carry it; absent is read as 'claude'.
   */
  platform_source?: string;
}

export interface SessionSummarySearchResult extends SessionSummaryRow {
  rank?: number; 
  score?: number; 
}

export interface UserPromptSearchResult extends UserPromptRow {
  rank?: number; 
  score?: number; 
}

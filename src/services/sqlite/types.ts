
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

/**
 * One billing-relevant model call, durable. Written by two independent
 * capture paths (see token_usage_events in SessionStore) and read only in
 * aggregate by the Token Burn screen.
 *
 * The four token buckets stay separate all the way to the query: cache reads
 * bill at roughly a tenth of input and dominate the raw sum, so a single
 * total_tokens column would make the plugin's own spend look ~10x worse than
 * it is. Derivation belongs in the SELECT, not in the writer.
 */
export interface TokenUsageEvent {
  /**
   * Idempotency key. For transcript rows this MUST be the assistant
   * message.id: Claude Code writes one API response across up to five JSONL
   * lines that share message.id and usage but each carry a distinct uuid, so
   * keying on uuid over-counts by ~1.65x on a real transcript. The UNIQUE
   * index is the mechanism that makes re-reads safe, not a safety net.
   */
  eventKey: string;
  /** 'plugin' = claude-mem's own spend, 'user' = the operator's own sessions. */
  source: 'plugin' | 'user';
  /** Which part of the plugin, or 'session' for user rows. */
  component: 'observer' | 'vectorless' | 'session';
  platformSource?: string;
  project?: string | null;
  sessionDbId?: number | null;
  contentSessionId?: string | null;
  model?: string | null;
  inputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  /** NULL when the provider did not report one. Never estimated. */
  costUsd?: number | null;
  isSidechain?: boolean;
  epoch: number;
}

/** Byte-offset watermark for one transcript file. */
export interface TranscriptReadState {
  transcriptPath: string;
  byteOffset: number;
  fileSize: number;
  lastMessageId: string | null;
  updatedAtEpoch: number;
}

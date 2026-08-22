export interface Observation {
  id: number;
  memory_session_id: string;
  project: string;
  merged_into_project?: string | null;
  platform_source: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  text: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export interface Summary {
  id: number;
  session_id: string;
  project: string;
  platform_source: string;
  request?: string;
  investigated?: string;
  learned?: string;
  completed?: string;
  next_steps?: string;
  created_at_epoch: number;
}

export interface UserPrompt {
  id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  prompt_number: number;
  prompt_text: string;
  created_at_epoch: number;
}

export type FeedItem =
  | (Observation & { itemType: 'observation' })
  | (Summary & { itemType: 'summary' })
  | (UserPrompt & { itemType: 'prompt' });

export interface StreamEvent {
  type: 'initial_load' | 'new_observation' | 'new_summary' | 'new_prompt' | 'processing_status';
  observations?: Observation[];
  summaries?: Summary[];
  prompts?: UserPrompt[];
  projects?: string[];
  observation?: Observation;
  summary?: Summary;
  prompt?: UserPrompt;
  isProcessing?: boolean;
  queueDepth?: number;
}


/** One node-worth of an observation in the Explorer graph. */
export interface ExplorerDayObservation {
  id: number;
  sessionId: string;
  contentSessionId: string;
  project: string;
  platformSource: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  promptNumber: number | null;
  createdAt: number;
}

/** Shape of GET /api/explorer/day. */
export interface ExplorerDay {
  /** null only when nothing is recorded at all. */
  day: string | null;
  /** Every day with observations, ascending — drives the date stepper. */
  days: string[];
  observations: ExplorerDayObservation[];
}

/** Shape of GET /api/stats. */
export interface WorkerStats {
  worker: {
    version: string;
    uptime: number;
    activeSessions: number;
    sseClients: number;
    port: number;
  };
  database: {
    path: string;
    size: number;
    observations: number;
    sessions: number;
    summaries: number;
    firstObservationAt: string | null;
  };
}

export interface ProjectCatalog {
  projects: string[];
  sources: string[];
  projectsBySource: Record<string, string[]>;
}

export interface Settings {
  CLAUDE_MEM_MODEL: string;
  CLAUDE_MEM_CONTEXT_OBSERVATIONS: string;
  CLAUDE_MEM_WORKER_PORT: string;
  CLAUDE_MEM_WORKER_HOST: string;

  CLAUDE_MEM_PROVIDER?: string;  
  CLAUDE_MEM_GEMINI_API_KEY?: string;
  CLAUDE_MEM_GEMINI_MODEL?: string;  
  CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED?: string;  
  CLAUDE_MEM_OPENROUTER_API_KEY?: string;
  CLAUDE_MEM_OPENROUTER_MODEL?: string;
  CLAUDE_MEM_OPENROUTER_SITE_URL?: string;
  CLAUDE_MEM_OPENROUTER_APP_NAME?: string;

  CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS?: string;
  CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS?: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT?: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT?: string;

  CLAUDE_MEM_CONTEXT_FULL_COUNT?: string;
  CLAUDE_MEM_CONTEXT_FULL_FIELD?: string;
  CLAUDE_MEM_CONTEXT_SESSION_COUNT?: string;

  CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY?: string;
  CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE?: string;
}

/**
 * A search row carries `platform_source` from a COALESCE in the SessionSearch
 * SQL, but the server's ObservationRow type does not declare it — so it is
 * optional here rather than required, and the card gets a default at the call
 * site instead of a cast that would hide the gap.
 */
export type SearchObservation = Omit<Observation, 'platform_source'> & { platform_source?: string };

/** The vectorless walk's own account of how it reached its answer. */
export interface MemoryWalkTraversal {
  rounds: number;
  daysWalked: string[];
  sessionsWalked: string[];
  indexRows: number;
}

/** Observation counts per platform source, before and after the walk picked. */
export interface MemoryWalkCoverage {
  indexed: Record<string, number>;
  matched: Record<string, number>;
}

/**
 * Shape of GET /api/search/temporal. Note the 200-with-`error` case: when
 * vectorless retrieval is switched off the endpoint still answers 200, so
 * `response.ok` alone never proves a walk happened.
 */
export interface MemoryWalkResponse {
  observations?: SearchObservation[];
  coverage?: MemoryWalkCoverage;
  traversal?: MemoryWalkTraversal;
  strategy?: string;
  error?: string;
  hint?: string;
}

/** Shape of GET /api/search?format=json — the keyword fallback. */
export interface KeywordSearchResponse {
  observations?: SearchObservation[];
  sessions?: unknown[];
  prompts?: unknown[];
  totalResults?: number;
  query?: string;
}

import type {
  KeywordSearchResponse,
  MemoryWalkCoverage,
  MemoryWalkResponse,
  MemoryWalkTraversal,
  SearchObservation,
} from '../types.js';

export type ChatTurnState = 'walking' | 'done' | 'error' | 'stopped';

/** Which retrieval path produced the answer, so a turn never overstates itself. */
export type ChatTurnSource = 'walk' | 'keyword';

export interface ChatTurn {
  id: number;
  question: string;
  state: ChatTurnState;
  source?: ChatTurnSource;
  observations: SearchObservation[];
  traversal?: MemoryWalkTraversal;
  coverage?: MemoryWalkCoverage;
  /** What the keyword path found but this screen does not render. */
  omitted?: { sessions: number; prompts: number };
  /** The server's own words when the walk declined — shown verbatim. */
  note?: string;
  error?: string;
}

/** The only strategy that actually walks the index; anything else is not one. */
const WALK_STRATEGY = 'vectorless';

/**
 * Either the walk answered, or we fall through to keyword search carrying a
 * note that says why. The disabled case arrives as HTTP 200 with an `error`
 * field, so status alone cannot decide this — and neither can the absence of an
 * error, because the orchestrator answers a failed walk with plain SQLite
 * results (SearchOrchestrator.ts:66) under HTTP 200 and no error at all. Only
 * the strategy the server names can tell those apart.
 */
export type WalkOutcome =
  | { kind: 'walk'; observations: SearchObservation[]; traversal?: MemoryWalkTraversal; coverage?: MemoryWalkCoverage }
  | { kind: 'fallback'; note?: string };

export function readWalkResponse(ok: boolean, status: number, body: MemoryWalkResponse | null): WalkOutcome {
  if (!ok) {
    return { kind: 'fallback', note: `The retrieval walk answered with HTTP ${status}.` };
  }
  if (!body || body.error) {
    const note = [body?.error, body?.hint].filter(Boolean).join(' — ');
    return { kind: 'fallback', note: note || undefined };
  }
  if (body.strategy !== WALK_STRATEGY) {
    // Understate rather than overstate: a turn that says it walked the index
    // while showing keyword hits is worse than one that admits it fell back.
    return {
      kind: 'fallback',
      note: body.strategy
        ? `The retrieval walk did not run — the server answered with ${body.strategy} search.`
        : 'The retrieval walk did not run — the server did not say which search answered.',
    };
  }
  return {
    kind: 'walk',
    observations: body.observations ?? [],
    traversal: body.traversal,
    coverage: body.coverage,
  };
}

export function readKeywordResponse(body: KeywordSearchResponse | null): {
  observations: SearchObservation[];
  omitted: { sessions: number; prompts: number };
} {
  return {
    observations: body?.observations ?? [],
    omitted: {
      sessions: body?.sessions?.length ?? 0,
      prompts: body?.prompts?.length ?? 0,
    },
  };
}

export function plural(count: number, singular: string, many = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : many}`;
}

export interface WalkStep {
  label: string;
  detail: string;
}

/**
 * Describes the walk that actually ran rather than a fixed ladder: the day
 * pass only happens when the day count exceeds the configured limit, so on a
 * small database `rounds` is 1 and there is no narrowing step to show.
 */
export function describeWalk(traversal: MemoryWalkTraversal, matched: number): WalkStep[] {
  const steps: WalkStep[] = [
    {
      label: 'Built the index',
      detail: `${plural(traversal.indexRows, 'observation')} read straight from SQLite — nothing cached, nothing embedded.`,
    },
  ];

  if (traversal.rounds >= 2) {
    steps.push({
      label: 'Narrowed to days',
      detail: `Kept ${plural(traversal.daysWalked.length, 'day')}: ${traversal.daysWalked.join(', ')}.`,
    });
  } else {
    steps.push({
      label: 'Skipped day narrowing',
      detail: `${plural(traversal.daysWalked.length, 'day')} fit under the limit, so every one stayed in.`,
    });
  }

  steps.push({
    label: 'Picked the answers',
    detail: `${plural(matched, 'observation')} across ${plural(traversal.sessionsWalked.length, 'session')}.`,
  });

  return steps;
}

/** Sources that were indexed but never matched — a walk ignoring a platform. */
export function unmatchedSources(coverage: MemoryWalkCoverage): string[] {
  return Object.keys(coverage.indexed).filter(source => !coverage.matched[source]);
}

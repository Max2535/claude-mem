# Vectorless Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in LLM-guided (embedding-free) retrieval strategy, a `temporal_search` MCP tool that walks multiple days/branches in one pass, and per-source coverage breakdown in results.

**Architecture:** New `VectorlessSearchStrategy` beside the existing Chroma/SQLite/Hybrid strategies in `SearchOrchestrator`. It builds a compact day-level index live from SQLite (never stale), lets an LLM (via the existing claude-agent-sdk one-shot pattern) pick days then observation IDs, and returns results with a `coverage` source breakdown. A new worker route `/api/search/temporal` and MCP tool `temporal_search` expose the cross-temporal pass.

**Tech Stack:** TypeScript, Bun (`bun:test`), Express worker routes, `@anthropic-ai/claude-agent-sdk` (already a dep), SQLite via existing `SessionSearch`.

**Spec:** `docs/superpowers/specs/2026-08-21-vectorless-retrieval-spec.md`

## Global Constraints

- No new npm dependencies.
- Feature off by default: `CLAUDE_MEM_VECTORLESS_ENABLED: 'false'`.
- Cost bounds: `CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS: '500'`, `CLAUDE_MEM_VECTORLESS_MAX_DAYS: '14'`.
- No persisted secondary index — index built per query from SQLite (staleness impossible by design).
- Vectorless v1 returns observations only; `sessions`/`prompts` arrays stay empty.
- Tests use `bun:test`, live under `tests/search/`, run with `bun test tests/search/<file>`.
- Comments in shipped code follow repo conventions (sparse; constraint-only). Never edit the changelog (auto-generated).
- Build check when a task touches worker/MCP wiring: `npm run build` must succeed.

---

### Task 1: Types + source coverage module

**Files:**
- Modify: `src/services/worker/search/types.ts`
- Create: `src/services/worker/search/vectorless/coverage.ts`
- Test: `tests/search/vectorless-coverage.test.ts`

**Interfaces:**
- Consumes: `normalizePlatformSource(value?: string | null): string` from `src/shared/platform-source.ts`; `ObservationSearchResult` re-exported by `src/services/worker/search/types.ts`.
- Produces (later tasks rely on these exact names):
  - `SearchStrategyHint` now includes `'vectorless'`.
  - `interface SourceCoverage { indexed: Record<string, number>; matched: Record<string, number>; }`
  - `interface TraversalTrace { rounds: number; daysWalked: string[]; sessionsWalked: string[]; indexRows: number; }`
  - `StrategySearchResult` gains optional `coverage?: SourceCoverage` and `traversal?: TraversalTrace`.
  - `computeSourceCoverage(indexed: ObservationSearchResult[], matched: ObservationSearchResult[]): SourceCoverage`

- [ ] **Step 1: Write the failing test**

```ts
// tests/search/vectorless-coverage.test.ts
import { describe, test, expect } from 'bun:test';
import { computeSourceCoverage } from '../../src/services/worker/search/vectorless/coverage.js';
import type { ObservationSearchResult } from '../../src/services/worker/search/types.js';

function obs(id: number, platform_source?: string): ObservationSearchResult {
  return {
    id,
    memory_session_id: `s-${id}`,
    project: 'demo',
    text: null,
    type: 'discovery',
    title: `obs ${id}`,
    subtitle: null,
    facts: null,
    narrative: null,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: null,
    discovery_tokens: 0,
    created_at: '2026-08-18 10:00:00',
    created_at_epoch: 1787392800000,
    ...(platform_source !== undefined ? { platform_source } : {}),
  } as ObservationSearchResult;
}

describe('computeSourceCoverage', () => {
  test('counts normalized sources for indexed and matched sets', () => {
    const indexed = [obs(1, 'claude'), obs(2, 'codex'), obs(3, 'browser'), obs(4)];
    const matched = [indexed[0], indexed[2]];
    const coverage = computeSourceCoverage(indexed, matched);
    expect(coverage.indexed).toEqual({ claude: 2, codex: 1, browser: 1 }); // undefined → 'claude'
    expect(coverage.matched).toEqual({ claude: 1, browser: 1 });
  });

  test('empty inputs produce empty maps', () => {
    expect(computeSourceCoverage([], [])).toEqual({ indexed: {}, matched: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/vectorless-coverage.test.ts`
Expected: FAIL — cannot resolve `coverage.js` module.

- [ ] **Step 3: Add types**

In `src/services/worker/search/types.ts`, change the hint union and result interface, and add the new interfaces:

```ts
export type SearchStrategyHint = 'chroma' | 'sqlite' | 'hybrid' | 'vectorless' | 'auto';

export interface SourceCoverage {
  indexed: Record<string, number>;
  matched: Record<string, number>;
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
```

(Only `SearchStrategyHint` and `StrategySearchResult` are edits of existing declarations; `SourceCoverage` and `TraversalTrace` are new. Everything else in the file stays.)

- [ ] **Step 4: Write coverage module**

```ts
// src/services/worker/search/vectorless/coverage.ts
import { normalizePlatformSource } from '../../../../shared/platform-source.js';
import type { ObservationSearchResult, SourceCoverage } from '../types.js';

function countBySource(rows: ObservationSearchResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
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
```

Note: `platform_source` is not on the `ObservationRow` interface but IS present on rows returned by `SessionSearch` SQL (COALESCE'd) — hence the narrow cast.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/search/vectorless-coverage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/worker/search/types.ts src/services/worker/search/vectorless/coverage.ts tests/search/vectorless-coverage.test.ts
git commit -m "feat(search): add vectorless strategy hint and source coverage module"
```

---

### Task 2: Day/observation index builder

**Files:**
- Create: `src/services/worker/search/vectorless/IndexBuilder.ts`
- Test: `tests/search/vectorless-index.test.ts`

**Interfaces:**
- Consumes: `ObservationSearchResult` from `../types.js`; `normalizePlatformSource` from shared.
- Produces:
  - `dayOf(row: ObservationSearchResult): string` — `created_at.slice(0, 10)` (`YYYY-MM-DD`).
  - `interface DayIndexEntry { day: string; count: number; sessions: string[]; sources: string[]; sampleTitles: string[]; }`
  - `buildDayIndex(rows: ObservationSearchResult[]): DayIndexEntry[]` — newest day first.
  - `renderDayIndex(days: DayIndexEntry[]): string`
  - `renderObservationIndex(rows: ObservationSearchResult[]): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/search/vectorless-index.test.ts
import { describe, test, expect } from 'bun:test';
import { buildDayIndex, renderDayIndex, renderObservationIndex, dayOf } from '../../src/services/worker/search/vectorless/IndexBuilder.js';
import type { ObservationSearchResult } from '../../src/services/worker/search/types.js';

function obs(id: number, created_at: string, extra: Partial<ObservationSearchResult> = {}): ObservationSearchResult {
  return {
    id,
    memory_session_id: extra.memory_session_id ?? `s-${id}`,
    project: 'demo',
    text: null,
    type: 'discovery',
    title: extra.title ?? `obs ${id}`,
    subtitle: null,
    facts: null,
    narrative: null,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: null,
    discovery_tokens: 0,
    created_at,
    created_at_epoch: 0,
    ...extra,
  } as ObservationSearchResult;
}

describe('IndexBuilder', () => {
  const rows = [
    obs(3, '2026-08-19 09:00:00', { memory_session_id: 'sess-b', title: 'fix worker restart' }),
    obs(2, '2026-08-18 15:00:00', { memory_session_id: 'sess-a', title: 'chroma sync retry' }),
    obs(1, '2026-08-18 10:00:00', { memory_session_id: 'sess-a', title: 'schema migration' }),
  ];

  test('dayOf slices date part', () => {
    expect(dayOf(rows[0])).toBe('2026-08-19');
  });

  test('buildDayIndex groups by day, newest first, distinct sessions', () => {
    const days = buildDayIndex(rows);
    expect(days.map(d => d.day)).toEqual(['2026-08-19', '2026-08-18']);
    expect(days[1].count).toBe(2);
    expect(days[1].sessions).toEqual(['sess-a']);
    expect(days[1].sampleTitles).toEqual(['chroma sync retry', 'schema migration']);
  });

  test('renderDayIndex emits one line per day with counts', () => {
    const text = renderDayIndex(buildDayIndex(rows));
    expect(text).toContain('2026-08-18 | 2 obs | sessions: 1 | sources: claude');
    expect(text).toContain('chroma sync retry');
  });

  test('renderObservationIndex emits [id] day title lines', () => {
    const text = renderObservationIndex(rows);
    expect(text).toContain('[3] 2026-08-19 discovery (claude) fix worker restart');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/vectorless-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement IndexBuilder**

```ts
// src/services/worker/search/vectorless/IndexBuilder.ts
import { normalizePlatformSource } from '../../../../shared/platform-source.js';
import type { ObservationSearchResult } from '../types.js';

const SAMPLE_TITLES_PER_DAY = 5;

export interface DayIndexEntry {
  day: string;
  count: number;
  sessions: string[];
  sources: string[];
  sampleTitles: string[];
}

export function dayOf(row: ObservationSearchResult): string {
  return (row.created_at ?? '').slice(0, 10);
}

function sourceOf(row: ObservationSearchResult): string {
  return normalizePlatformSource((row as { platform_source?: string }).platform_source);
}

export function buildDayIndex(rows: ObservationSearchResult[]): DayIndexEntry[] {
  const byDay = new Map<string, ObservationSearchResult[]>();
  for (const row of rows) {
    const day = dayOf(row);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(row);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayRows]) => ({
      day,
      count: dayRows.length,
      sessions: [...new Set(dayRows.map(r => r.memory_session_id))],
      sources: [...new Set(dayRows.map(sourceOf))],
      sampleTitles: dayRows.slice(0, SAMPLE_TITLES_PER_DAY).map(r => r.title ?? '(untitled)'),
    }));
}

export function renderDayIndex(days: DayIndexEntry[]): string {
  return days
    .map(d => `${d.day} | ${d.count} obs | sessions: ${d.sessions.length} | sources: ${d.sources.join(',')} | e.g. ${d.sampleTitles.map(t => `"${t}"`).join(', ')}`)
    .join('\n');
}

export function renderObservationIndex(rows: ObservationSearchResult[]): string {
  return rows
    .map(r => `[${r.id}] ${dayOf(r)} ${r.type} (${sourceOf(r)}) ${r.title ?? '(untitled)'}`)
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/search/vectorless-index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/search/vectorless/IndexBuilder.ts tests/search/vectorless-index.test.ts
git commit -m "feat(search): day/observation index builder for vectorless retrieval"
```

---

### Task 3: Traversal agent (LLM selection, injectable)

**Files:**
- Create: `src/services/worker/search/vectorless/TraversalAgent.ts`
- Create: `src/services/worker/search/vectorless/llm-runner.ts`
- Test: `tests/search/vectorless-traversal.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except types.
- Produces:
  - `type LlmFn = (prompt: string) => Promise<string>;`
  - `parseTraversalResponse(text: string): { days?: string[]; ids?: number[] }` — tolerant JSON extraction (bare JSON or fenced ```json block); throws `Error('No JSON object in LLM response')` when none found.
  - `class TraversalAgent { constructor(llm: LlmFn); selectDays(query: string, dayIndexText: string, maxDays: number): Promise<string[]>; selectObservations(query: string, obsIndexText: string, limit: number): Promise<number[]>; }`
  - `runVectorlessLlm(prompt: string): Promise<string>` — production `LlmFn` using claude-agent-sdk one-shot (no session resume).

- [ ] **Step 1: Write the failing test**

```ts
// tests/search/vectorless-traversal.test.ts
import { describe, test, expect } from 'bun:test';
import { TraversalAgent, parseTraversalResponse } from '../../src/services/worker/search/vectorless/TraversalAgent.js';

describe('parseTraversalResponse', () => {
  test('parses bare JSON', () => {
    expect(parseTraversalResponse('{"days":["2026-08-18"]}')).toEqual({ days: ['2026-08-18'] });
  });

  test('parses fenced JSON with prose around it', () => {
    const text = 'Picking these:\n```json\n{"ids": [3, 1]}\n```\ndone';
    expect(parseTraversalResponse(text)).toEqual({ ids: [3, 1] });
  });

  test('throws when no JSON present', () => {
    expect(() => parseTraversalResponse('no idea')).toThrow('No JSON object in LLM response');
  });
});

describe('TraversalAgent', () => {
  test('selectDays returns parsed days capped at maxDays', async () => {
    const agent = new TraversalAgent(async () => '{"days":["2026-08-19","2026-08-18","2026-08-17"]}');
    const days = await agent.selectDays('worker restart bug', 'INDEX', 2);
    expect(days).toEqual(['2026-08-19', '2026-08-18']);
  });

  test('selectObservations returns numeric ids capped at limit', async () => {
    const agent = new TraversalAgent(async () => '{"ids":[3,1,2]}');
    const ids = await agent.selectObservations('worker restart bug', 'INDEX', 2);
    expect(ids).toEqual([3, 1]);
  });

  test('prompt includes query and index text', async () => {
    let seen = '';
    const agent = new TraversalAgent(async (p) => { seen = p; return '{"ids":[]}'; });
    await agent.selectObservations('my query', 'MY-INDEX', 5);
    expect(seen).toContain('my query');
    expect(seen).toContain('MY-INDEX');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/vectorless-traversal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TraversalAgent**

```ts
// src/services/worker/search/vectorless/TraversalAgent.ts
export type LlmFn = (prompt: string) => Promise<string>;

export interface TraversalSelection {
  days?: string[];
  ids?: number[];
}

export function parseTraversalResponse(text: string): TraversalSelection {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const braced = candidate.match(/\{[\s\S]*\}/);
  if (!braced) throw new Error('No JSON object in LLM response');
  const parsed = JSON.parse(braced[0]);
  const result: TraversalSelection = {};
  if (Array.isArray(parsed.days)) result.days = parsed.days.map(String);
  if (Array.isArray(parsed.ids)) result.ids = parsed.ids.map(Number).filter(Number.isFinite);
  return result;
}

export class TraversalAgent {
  constructor(private llm: LlmFn) {}

  async selectDays(query: string, dayIndexText: string, maxDays: number): Promise<string[]> {
    const prompt = [
      `You are walking a memory index to answer: "${query}"`,
      `Each line below is one day of recorded work. Pick the days most likely to contain relevant observations — you may pick days far apart (the answer often spans multiple days and sessions).`,
      ``,
      dayIndexText,
      ``,
      `Respond with ONLY a JSON object: {"days": ["YYYY-MM-DD", ...]} — at most ${maxDays} days.`,
    ].join('\n');
    const response = await this.llm(prompt);
    return (parseTraversalResponse(response).days ?? []).slice(0, maxDays);
  }

  async selectObservations(query: string, obsIndexText: string, limit: number): Promise<number[]> {
    const prompt = [
      `You are selecting memory observations to answer: "${query}"`,
      `Each line below is one observation: [id] date type (source) title.`,
      ``,
      obsIndexText,
      ``,
      `Respond with ONLY a JSON object: {"ids": [<number>, ...]} — the most relevant ids, best first, at most ${limit}.`,
    ].join('\n');
    const response = await this.llm(prompt);
    return (parseTraversalResponse(response).ids ?? []).slice(0, limit);
  }
}
```

- [ ] **Step 4: Implement production LLM runner**

Same one-shot pattern as `KnowledgeAgent.executeQuery` (`src/services/worker/knowledge/KnowledgeAgent.ts:130-173`) but stateless — no `resume`, no session persistence:

```ts
// src/services/worker/search/vectorless/llm-runner.ts
// @ts-ignore - Agent SDK types may not be available
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildHardenedSdkOptions } from '../../../../sdk/hardened-options.js';
import { findClaudeExecutable } from '../../../../shared/find-claude-executable.js';
import { buildIsolatedEnvWithFreshOAuth } from '../../../../shared/EnvManager.js';
import { sanitizeEnv } from '../../../../supervisor/env-sanitizer.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../../../shared/paths.js';
import { resolveTierAlias } from '../../model-aliases.js';

export async function runVectorlessLlm(prompt: string): Promise<string> {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  const claudePath = findClaudeExecutable('WORKER');
  const isolatedEnv = sanitizeEnv(await buildIsolatedEnvWithFreshOAuth());

  const queryResult = query({
    prompt,
    options: buildHardenedSdkOptions({
      source: 'VectorlessTraversal',
      project: 'vectorless-search',
      model: resolveTierAlias(settings.CLAUDE_MEM_MODEL, settings),
      env: isolatedEnv,
      pathToClaudeCodeExecutable: claudePath,
    }),
  });

  let answer = '';
  try {
    for await (const msg of queryResult) {
      if (msg.type === 'assistant') {
        answer = msg.message.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
      }
    }
  } catch (error) {
    // Same tolerance as KnowledgeAgent: SDK process may exit after the answer arrives.
    if (!answer) throw error;
  }
  return answer;
}
```

Verify against the actual `buildHardenedSdkOptions` signature in `src/sdk/hardened-options.ts` before committing — if `source`/`project` fields differ, match the KnowledgeAgent call site exactly.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/search/vectorless-traversal.test.ts`
Expected: PASS (6 tests). (llm-runner is not unit-tested — it is a thin adapter over the SDK; exercised in integration.)

- [ ] **Step 6: Commit**

```bash
git add src/services/worker/search/vectorless/TraversalAgent.ts src/services/worker/search/vectorless/llm-runner.ts tests/search/vectorless-traversal.test.ts
git commit -m "feat(search): LLM traversal agent with injectable runner for vectorless retrieval"
```

---

### Task 4: VectorlessSearchStrategy + orchestrator wiring

**Files:**
- Create: `src/services/worker/search/strategies/VectorlessSearchStrategy.ts`
- Modify: `src/services/worker/search/SearchOrchestrator.ts` (constructor + `executeWithFallback`, currently lines 30-81)
- Test: `tests/search/vectorless-strategy.test.ts`

**Interfaces:**
- Consumes: `buildDayIndex`, `renderDayIndex`, `renderObservationIndex`, `dayOf` (Task 2); `TraversalAgent`, `LlmFn` (Task 3); `computeSourceCoverage` (Task 1); `SessionSearch.searchObservations(query: string | undefined, options: SearchOptions): ObservationSearchResult[]` (existing, `src/services/sqlite/SessionSearch.ts:247`).
- Produces:
  - `interface VectorlessConfig { maxIndexRows: number; maxDays: number; }`
  - `class VectorlessSearchStrategy { constructor(sessionSearch: SessionSearch, llm: LlmFn, config: VectorlessConfig); search(options: StrategySearchOptions): Promise<StrategySearchResult>; }`
  - `SearchOrchestrator` constructor gains 4th param `vectorlessStrategy: VectorlessSearchStrategy | null = null`; hint `'vectorless'` routes to it, falling back to SQLite on error.

- [ ] **Step 1: Write the failing test**

```ts
// tests/search/vectorless-strategy.test.ts
import { describe, test, expect } from 'bun:test';
import { VectorlessSearchStrategy } from '../../src/services/worker/search/strategies/VectorlessSearchStrategy.js';
import type { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import type { ObservationSearchResult } from '../../src/services/worker/search/types.js';

function obs(id: number, created_at: string, title: string, session = 'sess-a'): ObservationSearchResult {
  return {
    id, memory_session_id: session, project: 'demo', text: null, type: 'discovery',
    title, subtitle: null, facts: null, narrative: null, concepts: null,
    files_read: null, files_modified: null, prompt_number: null, discovery_tokens: 0,
    created_at, created_at_epoch: 0,
  } as ObservationSearchResult;
}

const ROWS = [
  obs(3, '2026-08-19 09:00:00', 'fix worker restart', 'sess-b'),
  obs(2, '2026-08-18 15:00:00', 'chroma sync retry'),
  obs(1, '2026-08-17 10:00:00', 'schema migration'),
];

function stubSearch(rows: ObservationSearchResult[]): SessionSearch {
  return { searchObservations: () => rows } as unknown as SessionSearch;
}

describe('VectorlessSearchStrategy', () => {
  test('single pass when days fit maxDays: one LLM call selecting ids', async () => {
    const calls: string[] = [];
    const strategy = new VectorlessSearchStrategy(
      stubSearch(ROWS),
      async (p) => { calls.push(p); return '{"ids":[3,1]}'; },
      { maxIndexRows: 500, maxDays: 14 }
    );
    const result = await strategy.search({ query: 'restart bug', limit: 20 });
    expect(calls.length).toBe(1);
    expect(result.strategy).toBe('vectorless');
    expect(result.results.observations.map(o => o.id)).toEqual([3, 1]);
    expect(result.traversal?.rounds).toBe(1);
    expect(result.traversal?.daysWalked).toEqual(['2026-08-19', '2026-08-18', '2026-08-17']);
    expect(result.traversal?.sessionsWalked.sort()).toEqual(['sess-a', 'sess-b']);
    expect(result.coverage?.indexed).toEqual({ claude: 3 });
    expect(result.coverage?.matched).toEqual({ claude: 2 });
  });

  test('two rounds when days exceed maxDays: day selection narrows candidates', async () => {
    const responses = ['{"days":["2026-08-19","2026-08-17"]}', '{"ids":[1]}'];
    const strategy = new VectorlessSearchStrategy(
      stubSearch(ROWS),
      async () => responses.shift()!,
      { maxIndexRows: 500, maxDays: 2 }
    );
    const result = await strategy.search({ query: 'migration', limit: 20 });
    expect(result.traversal?.rounds).toBe(2);
    expect(result.traversal?.daysWalked).toEqual(['2026-08-19', '2026-08-17']);
    expect(result.results.observations.map(o => o.id)).toEqual([1]);
  });

  test('empty query or no rows returns empty result without LLM calls', async () => {
    let called = 0;
    const strategy = new VectorlessSearchStrategy(
      stubSearch([]),
      async () => { called++; return '{}'; },
      { maxIndexRows: 500, maxDays: 14 }
    );
    const result = await strategy.search({ query: 'anything', limit: 20 });
    expect(called).toBe(0);
    expect(result.results.observations).toEqual([]);
    expect(result.coverage).toEqual({ indexed: {}, matched: {} });
  });

  test('ids not in candidate set are dropped', async () => {
    const strategy = new VectorlessSearchStrategy(
      stubSearch(ROWS),
      async () => '{"ids":[999,2]}',
      { maxIndexRows: 500, maxDays: 14 }
    );
    const result = await strategy.search({ query: 'retry', limit: 20 });
    expect(result.results.observations.map(o => o.id)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search/vectorless-strategy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement strategy**

```ts
// src/services/worker/search/strategies/VectorlessSearchStrategy.ts
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

    const indexRows: ObservationSearchResult[] = this.sessionSearch.searchObservations(undefined, {
      project,
      platformSource,
      dateRange,
      limit: this.config.maxIndexRows,
      orderBy: 'date_desc',
    });

    const empty: StrategySearchResult = {
      results: { observations: [], sessions: [], prompts: [] },
      usedChroma: false,
      strategy: 'vectorless',
      coverage: computeSourceCoverage(indexRows, []),
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
      coverage: computeSourceCoverage(indexRows, matched),
      traversal: {
        rounds,
        daysWalked: walkedDays,
        sessionsWalked: [...new Set(matched.map(r => r.memory_session_id))],
        indexRows: indexRows.length,
      },
    };
  }
}
```

Note the first test expects `sessionsWalked` from matched rows: ids `[3, 1]` → sessions `sess-b`, `sess-a`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/search/vectorless-strategy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into SearchOrchestrator**

In `src/services/worker/search/SearchOrchestrator.ts`:

Add import:

```ts
import { VectorlessSearchStrategy } from './strategies/VectorlessSearchStrategy.js';
```

Change constructor (currently lines 30-41) to accept the strategy:

```ts
  constructor(
    private sessionSearch: SessionSearch,
    private sessionStore: SessionStore,
    private chromaSync: ChromaSync | null,
    private vectorlessStrategy: VectorlessSearchStrategy | null = null
  ) {
    this.sqliteStrategy = new SQLiteSearchStrategy(sessionSearch);

    if (chromaSync) {
      this.chromaStrategy = new ChromaSearchStrategy(chromaSync, sessionStore);
      this.hybridStrategy = new HybridSearchStrategy(chromaSync, sessionStore, sessionSearch);
    }
  }
```

In `executeWithFallback`, insert after the filter-only early return (after line 55) and before the Chroma branch:

```ts
    if (options.strategyHint === 'vectorless' && this.vectorlessStrategy) {
      logger.debug('SEARCH', 'Orchestrator: Using vectorless traversal search', {});
      try {
        return await this.vectorlessStrategy.search(options);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        logger.error('WORKER', 'Orchestrator: Vectorless search failed, falling back to SQLite', {}, errorObj);
        return await this.sqliteStrategy.search(options);
      }
    }
```

- [ ] **Step 6: Run full search test suite + build**

Run: `bun test tests/search/ && npm run build`
Expected: all tests PASS, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/services/worker/search/strategies/VectorlessSearchStrategy.ts src/services/worker/search/SearchOrchestrator.ts tests/search/vectorless-strategy.test.ts
git commit -m "feat(search): vectorless LLM-guided search strategy wired into orchestrator"
```

---

### Task 5: Settings keys + SearchManager temporal search

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts` (DEFAULTS map ~line 117, and the `SettingsDefaults` interface it conforms to)
- Modify: `src/services/worker/SearchManager.ts` (constructor lines 38-50; new `temporalSearch` method)
- Test: `tests/search/temporal-search-manager.test.ts`

**Interfaces:**
- Consumes: `VectorlessSearchStrategy`, `VectorlessConfig` (Task 4); `runVectorlessLlm` (Task 3); `SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH)` (existing).
- Produces:
  - Settings keys (string values, matching the file's convention): `CLAUDE_MEM_VECTORLESS_ENABLED: 'false'`, `CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS: '500'`, `CLAUDE_MEM_VECTORLESS_MAX_DAYS: '14'`.
  - `SearchManager.temporalSearch(args: any): Promise<any>` — returns `{ content: [...] }`-free plain JSON: `{ error, hint }` when disabled, else `{ observations, coverage, traversal, strategy }`.
  - `SearchManager` constructor builds `VectorlessSearchStrategy` when enabled and passes it to `SearchOrchestrator`.

- [ ] **Step 1: Add settings defaults**

In `src/shared/SettingsDefaultsManager.ts`, add to the `SettingsDefaults` interface and to `DEFAULTS` (after `CLAUDE_MEM_MAX_CONCURRENT_AGENTS`):

```ts
    CLAUDE_MEM_VECTORLESS_ENABLED: 'false',  // LLM-guided index-walk retrieval; adds 1-2 SDK calls per query when on
    CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS: '500',  // Cap on observations loaded into the walked index per query
    CLAUDE_MEM_VECTORLESS_MAX_DAYS: '14',  // Day-selection round triggers only above this many distinct days
```

- [ ] **Step 2: Write the failing test**

The manager test avoids the real settings file and SDK by testing a factored helper. Add a static, pure factory to `SearchManager.ts` and test that plus the disabled path:

```ts
// tests/search/temporal-search-manager.test.ts
import { describe, test, expect } from 'bun:test';
import { buildVectorlessConfig } from '../../src/services/worker/SearchManager.js';

describe('buildVectorlessConfig', () => {
  test('disabled returns null', () => {
    expect(buildVectorlessConfig({ CLAUDE_MEM_VECTORLESS_ENABLED: 'false' } as any)).toBeNull();
  });

  test('enabled parses numeric bounds with defaults on garbage', () => {
    const config = buildVectorlessConfig({
      CLAUDE_MEM_VECTORLESS_ENABLED: 'true',
      CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS: '250',
      CLAUDE_MEM_VECTORLESS_MAX_DAYS: 'not-a-number',
    } as any);
    expect(config).toEqual({ maxIndexRows: 250, maxDays: 14 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/search/temporal-search-manager.test.ts`
Expected: FAIL — `buildVectorlessConfig` not exported.

- [ ] **Step 4: Implement config factory, constructor wiring, temporalSearch**

In `src/services/worker/SearchManager.ts` add imports:

```ts
import { VectorlessSearchStrategy, type VectorlessConfig } from './search/strategies/VectorlessSearchStrategy.js';
import { runVectorlessLlm } from './search/vectorless/llm-runner.js';
import { SettingsDefaultsManager, type SettingsDefaults } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
```

(Adjust the `SettingsDefaults` type import to however the file actually exports it.)

Add the exported factory above the class:

```ts
export function buildVectorlessConfig(settings: SettingsDefaults): VectorlessConfig | null {
  if (settings.CLAUDE_MEM_VECTORLESS_ENABLED !== 'true') return null;
  const parse = (value: string, fallback: number): number => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    maxIndexRows: parse(settings.CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS, 500),
    maxDays: parse(settings.CLAUDE_MEM_VECTORLESS_MAX_DAYS, 14),
  };
}
```

Change the constructor body (lines 44-50) to:

```ts
  ) {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const vectorlessConfig = buildVectorlessConfig(settings);
    this.vectorlessStrategy = vectorlessConfig
      ? new VectorlessSearchStrategy(sessionSearch, runVectorlessLlm, vectorlessConfig)
      : null;
    this.orchestrator = new SearchOrchestrator(
      sessionSearch,
      sessionStore,
      chromaSync,
      this.vectorlessStrategy
    );
  }
```

with the new field beside `orchestrator`:

```ts
  private vectorlessStrategy: VectorlessSearchStrategy | null;
```

Add the method (near the existing `search`/`timeline` methods):

```ts
  async temporalSearch(args: any): Promise<any> {
    if (!this.vectorlessStrategy) {
      return {
        error: 'Vectorless retrieval is disabled',
        hint: 'Set CLAUDE_MEM_VECTORLESS_ENABLED=true in ~/.claude-mem/settings.json and restart the worker',
      };
    }
    const dateRange = (args.dateStart || args.dateEnd)
      ? { start: args.dateStart, end: args.dateEnd }
      : undefined;
    const result = await this.orchestrator.search({
      query: args.query,
      limit: args.limit ? parseInt(String(args.limit), 10) : undefined,
      project: args.project,
      platformSource: args.platformSource,
      dateRange,
      strategyHint: 'vectorless',
    });
    return {
      observations: result.results.observations,
      coverage: result.coverage,
      traversal: result.traversal,
      strategy: result.strategy,
    };
  }
```

- [ ] **Step 5: Run test to verify it passes + build**

Run: `bun test tests/search/temporal-search-manager.test.ts && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts src/services/worker/SearchManager.ts tests/search/temporal-search-manager.test.ts
git commit -m "feat(search): vectorless settings, strategy wiring, and temporal search in SearchManager"
```

---

### Task 6: Worker route + MCP tool `temporal_search`

**Files:**
- Modify: `src/services/worker/http/routes/SearchRoutes.ts` (KNOWN_SEARCH_ENDPOINTS line 121-123; route registration ~line 150)
- Modify: `src/servers/mcp-server.ts` (tool table — insert after the `timeline` tool entry ending ~line 541)

**Interfaces:**
- Consumes: `SearchManager.temporalSearch(args)` (Task 5); existing `callWorker(path, { query: args })` helper in mcp-server.ts; existing `wrapHandler`/`queryWithPlatformSource` in SearchRoutes.
- Produces: HTTP `GET /api/search/temporal`; MCP tool `temporal_search`.

- [ ] **Step 1: Add worker route**

In `SearchRoutes.ts`, extend telemetry endpoint set:

```ts
    const KNOWN_SEARCH_ENDPOINTS = new Set([
      'unified', 'observations', 'by-file', 'temporal',
    ]);
```

Register route next to `/api/search/by-file` (line 150):

```ts
    app.get('/api/search/temporal', this.handleTemporalSearch.bind(this));
```

Add handler next to `handleSearchByFile`:

```ts
  private handleTemporalSearch = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await this.searchManager.temporalSearch(this.queryWithPlatformSource(req));
    res.json(result);
  });
```

- [ ] **Step 2: Register MCP tool**

In `src/servers/mcp-server.ts`, insert a new tool object after the `timeline` entry (after line 541), same shape as the `search` tool:

```ts
  {
    name: 'temporal_search',
    description: 'Cross-temporal memory search (vectorless): walks the day/session index across a date range in one LLM pass — good when the answer spans multiple days or branches and embedding top-k would miss it. Returns matched observations plus a per-source coverage breakdown (claude, codex, cursor, browser, docs, slack, ...). Requires CLAUDE_MEM_VECTORLESS_ENABLED=true. Params: query (required), dateStart, dateEnd, project, platformSource, limit',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to find across time' },
        dateStart: { type: 'string', description: 'Start date filter (ISO)' },
        dateEnd: { type: 'string', description: 'End date filter (ISO)' },
        project: { type: 'string', description: 'Filter by project name' },
        platformSource: { type: 'string', description: 'Filter by platform source (e.g. claude, codex, cursor)' },
        limit: { type: 'number', description: 'Max observations returned (default 20)' }
      },
      required: ['query'],
      additionalProperties: true
    },
    handler: async (args: any) => {
      return await callWorker('/api/search/temporal', { query: args });
    }
  },
```

- [ ] **Step 3: Build and smoke-test**

Run: `npm run build-and-sync`
Expected: build succeeds, worker restarts.

Then verify endpoint responds (worker port from settings, default `37700 + uid%100`):

```bash
curl -s "http://127.0.0.1:$(node -e "console.log(37700 + ((process.getuid?.() ?? 77) % 100))")/api/search/temporal?query=test"
```

Expected with the feature disabled (default): `{"error":"Vectorless retrieval is disabled","hint":"..."}`.
Then set `CLAUDE_MEM_VECTORLESS_ENABLED` to `"true"` in `~/.claude-mem/settings.json`, run `npm run worker:restart`, re-run the curl — expected: JSON with `observations`, `coverage`, `traversal`, `strategy: "vectorless"`.

- [ ] **Step 4: Commit**

```bash
git add src/services/worker/http/routes/SearchRoutes.ts src/servers/mcp-server.ts
git commit -m "feat(mcp): temporal_search tool and /api/search/temporal worker route"
```

---

### Task 7: Documentation

**Files:**
- Create: `docs/public/vectorless-retrieval.mdx`
- Modify: `docs/public/docs.json` (add the new page to navigation, following the existing entry format in that file)

**Interfaces:**
- Consumes: behavior implemented in Tasks 1-6 (settings keys, tool name, response shape).
- Produces: public doc page (auto-deploys on push to main).

- [ ] **Step 1: Write the doc page**

```mdx
---
title: "Vectorless Retrieval"
description: "LLM-guided memory search that walks a day index instead of embedding top-k"
---

## What it is

An opt-in retrieval mode where an LLM walks a compact index of your memory
(one line per day: observation count, sessions, sources, sample titles),
picks the relevant days, then picks specific observations. No embeddings
involved, and the index is built fresh from SQLite on every query — it can
never go stale.

## When to use it

Use the `temporal_search` MCP tool when the answer spans multiple days or
branches of work — e.g. "how did the worker restart handling evolve over the
last two weeks?" Embedding top-k tends to cluster on one day; the index walk
sees the whole range in one pass.

## Enabling

In `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_VECTORLESS_ENABLED": "true"
}
```

Then restart the worker (`npm run worker:restart` from the plugin directory,
or restart Claude Code).

## Cost and bounds

Each query costs 1-2 model calls (using your `CLAUDE_MEM_MODEL`). Bounds:

| Setting | Default | Meaning |
|---------|---------|---------|
| `CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS` | `500` | Max observations loaded into the walked index |
| `CLAUDE_MEM_VECTORLESS_MAX_DAYS` | `14` | Above this many days, a day-selection round runs first |

## Coverage breakdown

Every `temporal_search` result includes `coverage`: how many observations
per source (`claude`, `codex`, `cursor`, and any other `platform_source`
recorded, e.g. browser, docs, or Slack ingestions) were in the walked index
(`indexed`) and in the matched set (`matched`) — so you can see what the
retrieval actually looked at.
```

- [ ] **Step 2: Add to navigation**

Open `docs/public/docs.json`, find the navigation group containing the existing search/tooling pages, and append `"vectorless-retrieval"` following the same format as sibling entries.

- [ ] **Step 3: Commit**

```bash
git add docs/public/vectorless-retrieval.mdx docs/public/docs.json
git commit -m "docs: vectorless retrieval and temporal_search"
```

---

## Self-Review (done at plan time)

- **Spec coverage:** decision 1 (strategy beside Chroma) → Tasks 4-5; decision 2 (LLM walks index) → Tasks 2-4; decision 3 (temporal_search tool) → Tasks 5-6; decision 4 (coverage breakdown) → Tasks 1, 4, 6. Concerns: stale index → live-build (Task 4, spec); cost bounds → settings (Task 5); footprint → off-by-default, no new deps (Task 5, global constraints).
- **Placeholder scan:** none — all steps carry code.
- **Type consistency:** `LlmFn`, `VectorlessConfig`, `SourceCoverage`, `TraversalTrace`, `buildVectorlessConfig`, constructor orders checked across tasks.
- **Known verify-at-implementation points (flagged inline):** exact `buildHardenedSdkOptions` fields (Task 3 Step 4), exact `SettingsDefaults` export shape (Task 5 Step 4), docs.json entry format (Task 7 Step 2).

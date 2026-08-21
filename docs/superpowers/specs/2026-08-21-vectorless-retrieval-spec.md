# Vectorless Retrieval Spec

**Date:** 2026-08-21
**Status:** Confirmed with Max (AskUserQuestion, 2026-08-21)

## What

Add an LLM-guided, embedding-free ("vectorless") retrieval strategy to claude-mem, alongside the existing Chroma strategy. Expose cross-temporal search as a new MCP tool. Show per-source coverage in results.

## Confirmed decisions

1. **Position:** New `VectorlessSearchStrategy` registered in `SearchOrchestrator` alongside Chroma/SQLite/Hybrid. Chroma stays. Opt-in via settings.
2. **Mechanism:** Agent walks a structured index. The LLM reads a compact day-level index built live from SQLite, picks days/branches to expand, then picks observation IDs from an expanded per-observation index. No embeddings involved.
3. **Cross-temporal:** New separate MCP tool `temporal_search` — one LLM pass sees the full date range grouped by day and session (branch), so it can select across many days/branches in a single pass instead of hoping embedding top-k spans them.
4. **Coverage:** Results include a source breakdown (`coverage`): how many observations per platform source (claude, codex, cursor, browser, docs, slack, …) were in the walked index and in the matched set. No new ingestion pipelines.

## How the stated concerns are addressed

- **Stale index:** the vectorless index is built fresh from SQLite on every query (filter-only `searchObservations` call, cheap). There is no persisted secondary index, so it can never go stale.
- **Cost scales per query:** each vectorless query costs 1–2 SDK LLM calls. Bounded by settings: `CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS` (default 500) and `CLAUDE_MEM_VECTORLESS_MAX_DAYS` (default 14). Round 1 (day selection) is skipped when the range already fits in MAX_DAYS.
- **Runtime footprint:** no new dependencies, no new processes. Reuses the existing `@anthropic-ai/claude-agent-sdk` one-shot pattern (same as `KnowledgeAgent`). Feature is off by default (`CLAUDE_MEM_VECTORLESS_ENABLED=false`); when off, zero extra footprint.

## Non-goals

- Replacing Chroma.
- Ingesting new sources (browser history, docs sites, Slack) — coverage only reports what is already in SQLite under `platform_source`.
- Session summaries / user prompts in vectorless results (observations only, v1).

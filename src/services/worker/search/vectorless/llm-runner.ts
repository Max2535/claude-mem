import { logger } from '../../../../utils/logger.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH, OBSERVER_SESSIONS_DIR, ensureDir } from '../../../../shared/paths.js';
import { buildIsolatedEnvWithFreshOAuth } from '../../../../shared/EnvManager.js';
import { findClaudeExecutable } from '../../../../shared/find-claude-executable.js';
import { sanitizeEnv } from '../../../../supervisor/env-sanitizer.js';
import { resolveTierAlias } from '../../model-aliases.js';
import { waitForSlot, type SlotReservation } from '../../../../supervisor/process-registry.js';

// @ts-ignore - Agent SDK types may not be available
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildHardenedSdkOptions } from '../../../../sdk/hardened-options.js';

/**
 * A traversal round is two model calls at most and the caller is a blocking
 * HTTP request, so a stuck SDK process must not hold the connection open
 * forever. Generous enough that a slow-but-live model still answers.
 */
export const VECTORLESS_LLM_TIMEOUT_MS = 120_000;

/**
 * The two pieces of runVectorlessLlm that touch the machine: the concurrency
 * pool and the SDK subprocess. Everything else — the timeout, the abort/answer
 * distinction, releasing the slot on every exit path — is ordinary logic, and
 * splitting these out is what lets it be tested without spawning anything.
 */
export interface VectorlessLlmDeps {
  /**
   * Reserves an SDK slot, waiting if the pool is full. The reservation is held
   * for the whole call: unlike a spawned agent session, a traversal process is
   * never entered in the process registry, so nothing else would account for it.
   */
  acquireSlot(): Promise<SlotReservation>;
  /** Runs one traversal call, yielding SDK messages until the process ends. */
  runQuery(prompt: string, abortController: AbortController): AsyncIterable<any>;
  timeoutMs?: number;
}

/**
 * One-shot LLM call for index traversal. Stateless by design — no `resume`, so
 * each traversal round is independent and nothing is persisted between queries.
 *
 * Every call spawns a Claude Code subprocess, and `GET /api/search/temporal` is
 * an unauthenticated local endpoint — N concurrent requests would otherwise be
 * N concurrent subprocesses. Hence the slot gate and the timeout.
 */
export function createVectorlessLlmRunner(deps: VectorlessLlmDeps): (prompt: string) => Promise<string> {
  const timeoutMs = deps.timeoutMs ?? VECTORLESS_LLM_TIMEOUT_MS;

  return async function runVectorlessLlm(prompt: string): Promise<string> {
    const slotReservation = await deps.acquireSlot();

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      let answer = '';
      try {
        for await (const msg of deps.runQuery(prompt, abortController)) {
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
        const errorObj = error instanceof Error ? error : new Error(String(error));
        logger.debug('SEARCH', 'Vectorless SDK process exited after answer — continuing', {}, errorObj);
      }

      // An abort that produced no answer is a timeout, not an empty result: say so
      // rather than letting the caller read it as "the model chose nothing".
      if (!answer && abortController.signal.aborted) {
        throw new Error(`Vectorless traversal timed out after ${timeoutMs}ms`);
      }
      return answer;
    } finally {
      clearTimeout(timer);
      slotReservation.release();
    }
  };
}

/**
 * The real deps: the shared process pool (same one ClaudeProvider.spawn uses,
 * so the two cannot outbid each other) and a hardened SDK subprocess.
 */
export const productionVectorlessLlmDeps: VectorlessLlmDeps = {
  async acquireSlot(): Promise<SlotReservation> {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const maxConcurrent = parseInt(settings.CLAUDE_MEM_MAX_CONCURRENT_AGENTS, 10) || 2;
    return waitForSlot(maxConcurrent);
  },

  runQuery(prompt: string, abortController: AbortController): AsyncIterable<any> {
    // Deferred until iteration so the OAuth refresh happens inside the caller's
    // try/finally — a failure here must still release the slot.
    async function* run(): AsyncIterable<any> {
      ensureDir(OBSERVER_SESSIONS_DIR);
      const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
      const claudePath = findClaudeExecutable('WORKER');
      const isolatedEnv = sanitizeEnv(await buildIsolatedEnvWithFreshOAuth());

      yield* query({
        prompt,
        options: buildHardenedSdkOptions({
          source: 'VectorlessTraversal',
          project: 'vectorless-search',
          model: resolveTierAlias(settings.CLAUDE_MEM_MODEL, settings),
          env: isolatedEnv,
          pathToClaudeCodeExecutable: claudePath,
          abortController,
        }),
      });
    }
    return run();
  },
};

export const runVectorlessLlm = createVectorlessLlmRunner(productionVectorlessLlmDeps);

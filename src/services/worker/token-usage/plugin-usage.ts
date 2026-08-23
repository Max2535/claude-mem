import { logger } from '../../../utils/logger.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { ActiveSession } from '../../worker-types.js';

/**
 * The token buckets a provider reports for one call. All optional: a provider
 * that does not distinguish cache creation from cache reads simply leaves
 * them at zero rather than folding them into input, which would overstate
 * billable spend.
 */
export interface ProviderUsage {
  inputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  /** Provider-reported only. Never estimated from a price table. */
  costUsd?: number | null;
  model?: string | null;
}

/**
 * Persists one unit of claude-mem's OWN spend to token_usage_events.
 *
 * Deliberately swallows every failure: accounting runs inside the compression
 * generator, and a write that throws there would abort a user's compression to
 * protect a chart. A lost row is a gap in a graph; a thrown one loses work.
 */
export function recordPluginTokenUsage(
  dbManager: DatabaseManager,
  session: Pick<ActiveSession, 'sessionDbId' | 'contentSessionId' | 'project' | 'platformSource'>,
  component: 'observer' | 'vectorless',
  eventKey: string,
  usage: ProviderUsage
): void {
  try {
    dbManager.getSessionStore().recordTokenUsage({
      eventKey,
      source: 'plugin',
      component,
      platformSource: session.platformSource,
      project: session.project,
      sessionDbId: session.sessionDbId,
      contentSessionId: session.contentSessionId,
      model: usage.model ?? null,
      inputTokens: usage.inputTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd: usage.costUsd ?? null,
      epoch: Date.now(),
    });
  } catch (error) {
    logger.warn(
      'SDK',
      'Token usage not recorded — continuing',
      { sessionId: session.sessionDbId, component },
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Per-turn cost from the SDK's CUMULATIVE total_cost_usd.
 *
 * A total below the prior baseline means the SDK session restarted and its
 * accumulator reset, so the new total IS this turn's cost — subtracting would
 * yield a negative and silently credit the user for spend that happened.
 * Returns undefined when the provider reported no total; never estimated.
 */
export function turnCostFromCumulative(totalCostUsd: unknown, priorTotal: number | null | undefined): number | undefined {
  if (typeof totalCostUsd !== 'number' || !Number.isFinite(totalCostUsd)) return undefined;
  const prior = priorTotal ?? 0;
  return totalCostUsd >= prior ? totalCostUsd - prior : totalCostUsd;
}

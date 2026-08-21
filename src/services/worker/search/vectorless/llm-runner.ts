import { logger } from '../../../../utils/logger.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH, OBSERVER_SESSIONS_DIR, ensureDir } from '../../../../shared/paths.js';
import { buildIsolatedEnvWithFreshOAuth } from '../../../../shared/EnvManager.js';
import { findClaudeExecutable } from '../../../../shared/find-claude-executable.js';
import { sanitizeEnv } from '../../../../supervisor/env-sanitizer.js';
import { resolveTierAlias } from '../../model-aliases.js';

// @ts-ignore - Agent SDK types may not be available
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildHardenedSdkOptions } from '../../../../sdk/hardened-options.js';

/**
 * One-shot LLM call for index traversal. Stateless by design — no `resume`, so
 * each traversal round is independent and nothing is persisted between queries.
 */
export async function runVectorlessLlm(prompt: string): Promise<string> {
  ensureDir(OBSERVER_SESSIONS_DIR);
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
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.debug('SEARCH', 'Vectorless SDK process exited after answer — continuing', {}, errorObj);
  }
  return answer;
}

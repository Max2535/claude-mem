import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';
import { PLUGIN_SETTINGS_KEY } from './plugin-state.js';
import { MARKETPLACE_NAME, PLUGIN_NAME } from './plugin-identity.js';

/**
 * Warn when the MCP server is up but Claude Code will never fire our hooks.
 *
 * The authority is the loader's own registry, not a directory on disk. The
 * previous version of this check looked for `plugins/marketplaces/<name>/` and
 * stayed silent for 39 days on a machine where the plugin had never been
 * registered at all - the dev loop's `rsync` had created that directory, so the
 * heuristic saw a marketplace the loader knew nothing about. A path-registered
 * marketplace (`claude plugin marketplace add <dir>`) is the mirror image: no
 * directory ever appears, yet hooks fire normally.
 */
export function detectMissingMarketplaceMarker(home: string = homedir()): void {
  const configRoots = [
    resolve(home, '.claude', 'plugins'),
    resolve(home, '.config', 'claude', 'plugins'),
  ];

  const registered = configRoots.some((root) => {
    const registry = resolve(root, 'installed_plugins.json');
    if (!existsSync(registry)) return false;
    try {
      const parsed = JSON.parse(readFileSync(registry, 'utf-8')) as { plugins?: Record<string, unknown> };
      return Object.prototype.hasOwnProperty.call(parsed.plugins ?? {}, PLUGIN_SETTINGS_KEY);
    } catch {
      // An unreadable registry is not evidence of absence; stay quiet rather
      // than cry wolf on a transient half-written file.
      return true;
    }
  });
  if (registered) return;

  const cacheCandidates = configRoots.map((root) => resolve(root, 'cache', MARKETPLACE_NAME, PLUGIN_NAME));
  if (!cacheCandidates.some((p) => existsSync(p))) return;

  logger.error(
    'SYSTEM',
    `claude-mem MCP started but ${PLUGIN_SETTINGS_KEY} is not in Claude Code's installed-plugin registry. The loader only fires hooks (SessionStart, PostToolUse, Stop) for plugins it has registered, so MCP search will work while no new memories are captured. To fix: claude plugin marketplace add <repo-or-path> && claude plugin install ${PLUGIN_SETTINGS_KEY}`,
    { registryCandidates: configRoots.map((root) => resolve(root, 'installed_plugins.json')), cacheRoot: cacheCandidates[0] }
  );
}
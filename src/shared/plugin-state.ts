
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { parseJsonWithBom } from './atomic-json.js';

/**
 * The `<plugin>@<marketplace>` id Claude Code keys this plugin by, in both
 * `settings.json → enabledPlugins` and `plugins/installed_plugins.json`.
 * Exported because it is the only reliable "is the loader actually going to
 * fire our hooks?" signal: a marketplace directory on disk is not, as a stale
 * rsync copy of one satisfies that test while the loader ignores it.
 */
export const PLUGIN_SETTINGS_KEY = 'claude-mem-pro-max@max2535';

export function isPluginDisabledInClaudeSettings(): boolean {
  try {
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const settingsPath = join(claudeConfigDir, 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = parseJsonWithBom<Record<string, any>>(raw);
    return settings?.enabledPlugins?.[PLUGIN_SETTINGS_KEY] === false;
  } catch (error: unknown) {
    logger.error('CONFIG', 'Failed to read Claude settings', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

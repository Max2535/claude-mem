/**
 * This fork's identity, in one place.
 *
 * Claude Code keys a plugin by `<plugin>@<marketplace>`, and derives three
 * on-disk locations from those two names:
 *
 *   ~/.claude/plugins/marketplaces/<marketplace>/
 *   ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
 *   ~/.claude/plugins/data/<plugin>-<marketplace>/
 *
 * 87a7e4c renamed the plugin from `claude-mem@thedotmack` to
 * `claude-mem-pro-max@max2535` by editing the manifests and the generated hook
 * shell scripts, but the literals were spread across a dozen more files that
 * were missed. The result was a build whose hooks resolved against
 * `cache/max2535/claude-mem-pro-max` while its installer wrote to
 * `cache/thedotmack/claude-mem` — every hook failed to resolve, silently.
 *
 * These constants exist so the next rename is one edit rather than fourteen.
 * Nothing here may import anything: `paths.ts` and the build-time hook template
 * both depend on it, and a cycle through either is a boot failure.
 */

/** The marketplace key stored in `plugins/known_marketplaces.json`. */
export const MARKETPLACE_NAME = 'max2535';

/** The plugin name in `.claude-plugin/plugin.json`. */
export const PLUGIN_NAME = 'claude-mem-pro-max';

/**
 * The GitHub slug Claude Code pulls marketplace updates from. Upstream's slug
 * here would make `claude plugin marketplace update` replace this fork with the
 * project it was forked from.
 */
export const MARKETPLACE_REPO = 'Max2535/claude-mem';

/**
 * The `<plugin>@<marketplace>` id Claude Code keys this plugin by, in both
 * `settings.json → enabledPlugins` and `plugins/installed_plugins.json`.
 */
export const PLUGIN_SETTINGS_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/**
 * The per-plugin data directory name, which Claude Code spells
 * `<plugin>-<marketplace>` rather than with the `@` used everywhere else.
 */
export const PLUGIN_DATA_DIR_NAME = `${PLUGIN_NAME}-${MARKETPLACE_NAME}`;

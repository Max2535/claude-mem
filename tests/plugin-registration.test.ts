import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectMissingMarketplaceMarker } from '../src/shared/plugin-registration.js';
import { PLUGIN_SETTINGS_KEY } from '../src/shared/plugin-state.js';
import { logger } from '../src/utils/logger.js';

/**
 * The failure this guards against is silence, not noise: on a real machine the
 * plugin went unregistered for 39 days while the old directory-based check said
 * nothing, because the dev loop's rsync had left a marketplace directory behind.
 */
describe('detectMissingMarketplaceMarker', () => {
  let home: string;
  let errors: string[];
  let restore: () => void;

  function installedCache(): void {
    mkdirSync(join(home, '.claude', 'plugins', 'cache', 'max2535', 'claude-mem-pro-max', '13.15.3'), { recursive: true });
  }

  function registry(plugins: Record<string, unknown>): void {
    const dir = join(home, '.claude', 'plugins');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'cmem-reg-'));
    errors = [];
    const spy = spyOn(logger, 'error').mockImplementation(((_c: string, message: string) => {
      errors.push(message);
    }) as never);
    restore = () => spy.mockRestore();
  });

  afterEach(() => {
    restore();
    rmSync(home, { recursive: true, force: true });
  });

  it('warns when the plugin is installed on disk but absent from the registry', () => {
    installedCache();
    registry({ 'some-other-plugin@vendor': [{ scope: 'user' }] });
    detectMissingMarketplaceMarker(home);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(PLUGIN_SETTINGS_KEY);
  });

  it('stays silent once the plugin is in the registry', () => {
    installedCache();
    registry({ [PLUGIN_SETTINGS_KEY]: [{ scope: 'user' }] });
    detectMissingMarketplaceMarker(home);
    expect(errors).toEqual([]);
  });

  it('stays silent for a path-registered marketplace, which creates no marketplaces directory', () => {
    // `claude plugin marketplace add <dir>` declares the marketplace in
    // settings and installs into the cache; ~/.claude/plugins/marketplaces/
    // stays empty. A directory check calls this broken. It is not.
    installedCache();
    registry({ [PLUGIN_SETTINGS_KEY]: [{ scope: 'user' }] });
    detectMissingMarketplaceMarker(home);
    expect(errors).toEqual([]);
  });

  it('says nothing when the plugin is not installed at all', () => {
    registry({});
    detectMissingMarketplaceMarker(home);
    expect(errors).toEqual([]);
  });

  it('treats an unreadable registry as no evidence rather than crying wolf', () => {
    installedCache();
    const dir = join(home, '.claude', 'plugins');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'installed_plugins.json'), '{ half-written');
    detectMissingMarketplaceMarker(home);
    expect(errors).toEqual([]);
  });
});

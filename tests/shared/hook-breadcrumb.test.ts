import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendHookFailure,
  clearHookFailures,
  readHookFailures,
  renderHookFailureWarning,
} from '../../src/shared/hook-breadcrumb.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-breadcrumb-'));
  path = join(dir, 'hook-resolution-failures.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readHookFailures', () => {
  it('returns null when no breadcrumb exists', () => {
    expect(readHookFailures([path])).toBeNull();
  });

  it('reads back what the shell prelude appended', () => {
    appendHookFailure({ at: '2026-08-21T10:00:00Z', cwd: '/Users/max/swift', site: 'PostToolUse:observation' }, path);
    const report = readHookFailures([path])!;
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.site).toBe('PostToolUse:observation');
    expect(report.directories).toEqual(['/Users/max/swift']);
  });

  it('counts one occasion per day per directory, not per hook call', () => {
    // A broken install fires PostToolUse on every tool call. Counting lines
    // would report "312 sessions lost" for what was really two.
    for (let i = 0; i < 40; i++) {
      appendHookFailure({ at: `2026-08-21T10:${String(i % 60).padStart(2, '0')}:00Z`, cwd: '/Users/max/swift', site: 'PostToolUse:observation' }, path);
    }
    appendHookFailure({ at: '2026-08-22T09:00:00Z', cwd: '/Users/max/swift', site: 'Stop:summarize' }, path);
    appendHookFailure({ at: '2026-08-22T09:01:00Z', cwd: '/Users/max/other', site: 'Stop:summarize' }, path);

    const report = readHookFailures([path])!;
    expect(report.entries).toHaveLength(42);
    expect(report.occasions).toBe(3);
    expect(report.directories).toEqual(['/Users/max/swift', '/Users/max/other']);
  });

  it('orders by timestamp regardless of append order', () => {
    appendHookFailure({ at: '2026-08-22T09:00:00Z', cwd: '/a', site: 'Stop:summarize' }, path);
    appendHookFailure({ at: '2026-08-20T09:00:00Z', cwd: '/a', site: 'Stop:summarize' }, path);
    const report = readHookFailures([path])!;
    expect(report.firstAt).toBe('2026-08-20T09:00:00Z');
    expect(report.lastAt).toBe('2026-08-22T09:00:00Z');
  });

  it('skips malformed lines instead of throwing', () => {
    writeFileSync(path, ['garbage', '', '\t\t', '2026-08-21T10:00:00Z\t/a\tStop:summarize'].join('\n'));
    const report = readHookFailures([path])!;
    expect(report.entries).toHaveLength(1);
  });

  it('merges the configured and default data-dir breadcrumbs', () => {
    // The shell prelude honours only $CLAUDE_MEM_DATA_DIR, so a data dir set in
    // settings.json leaves breadcrumbs in the default location. Reading one
    // path only would hide them.
    const other = join(dir, 'default', 'hook-resolution-failures.log');
    appendHookFailure({ at: '2026-08-21T10:00:00Z', cwd: '/a', site: 'Stop:summarize' }, path);
    appendHookFailure({ at: '2026-08-21T11:00:00Z', cwd: '/b', site: 'Stop:summarize' }, other);
    const report = readHookFailures([path, other])!;
    expect(report.entries).toHaveLength(2);
    expect(report.directories.sort()).toEqual(['/a', '/b']);
  });
});

describe('renderHookFailureWarning', () => {
  it('names the directories whose sessions were lost', () => {
    appendHookFailure({ at: '2026-08-21T10:00:00Z', cwd: '/Users/max/swift', site: 'Stop:summarize' }, path);
    const text = renderHookFailureWarning(readHookFailures([path])!);
    expect(text).toContain('/Users/max/swift');
    expect(text).toContain('nothing was recorded');
  });
});

describe('clearHookFailures', () => {
  it('removes the breadcrumb so the warning does not repeat', () => {
    appendHookFailure({ at: '2026-08-21T10:00:00Z', cwd: '/a', site: 'Stop:summarize' }, path);
    clearHookFailures([path]);
    expect(existsSync(path)).toBe(false);
    expect(readHookFailures([path])).toBeNull();
  });

  it('does not throw when there is nothing to clear', () => {
    expect(() => clearHookFailures([path])).not.toThrow();
  });
});

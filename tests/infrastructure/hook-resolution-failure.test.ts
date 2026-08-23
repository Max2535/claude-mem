import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const HOOKS = JSON.parse(
  readFileSync(join(import.meta.dir, '../../plugin/hooks/hooks.json'), 'utf-8')
) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };

const CLAUDE_SITES: Array<[string, number, number, string]> = [
  ['Setup', 0, 0, 'Setup:version-check'],
  ['SessionStart', 0, 0, 'SessionStart:start'],
  ['SessionStart', 0, 1, 'SessionStart:context'],
  ['UserPromptSubmit', 0, 0, 'UserPromptSubmit:session-init'],
  ['PreToolUse', 0, 0, 'PreToolUse:file-context'],
  ['PostToolUse', 0, 0, 'PostToolUse:observation'],
  ['Stop', 0, 0, 'Stop:summarize'],
];

function commandAt(event: string, group: number, index: number): string {
  const command = HOOKS.hooks[event]?.[group]?.hooks?.[index]?.command;
  if (!command) throw new Error(`no hook command at ${event}.${group}.${index}`);
  return command;
}

let root: string;

/**
 * Run a hook command with every resolution candidate pointed at empty
 * directories, reproducing the failure that dropped five weeks of sessions:
 * no CLAUDE_PLUGIN_ROOT, no cache version dir, no marketplace install.
 */
function runUnresolvable(command: string): { status: number; stdout: string; dataDir: string } {
  const cwd = join(root, 'cwd');
  const dataDir = join(root, 'data');
  const configDir = join(root, 'config');
  for (const dir of [cwd, configDir]) mkdirSync(dir, { recursive: true });

  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync('bash', ['-c', command], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: root,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_MEM_DATA_DIR: dataDir,
        CLAUDE_PLUGIN_ROOT: '',
        PLUGIN_ROOT: '',
      },
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    status = failure.status ?? 1;
    stdout = failure.stdout ?? '';
  }
  return { status, stdout, dataDir };
}

function breadcrumbLines(dataDir: string): string[] {
  const path = join(dataDir, 'hook-resolution-failures.log');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cm-hook-fail-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('hook resolution failure', () => {
  it.each(CLAUDE_SITES)('leaves a breadcrumb from %s.%i.%i', (event, group, index, site) => {
    const { dataDir } = runUnresolvable(commandAt(event as string, group as number, index as number));
    const lines = breadcrumbLines(dataDir);
    expect(lines).toHaveLength(1);
    const [at, cwd, recordedSite] = lines[0]!.split('\t');
    expect(recordedSite).toBe(site as string);
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(cwd).toContain('cwd');
  });

  it('emits a parseable SessionStart result from the context hook, and exits 0', () => {
    // The whole point of the stdout branch. A second JSON document, an unquoted
    // apostrophe, or a stray shell word here makes Claude Code discard the
    // payload — the failure mode this warning exists to avoid.
    const { status, stdout } = runUnresolvable(commandAt('SessionStart', 0, 1));
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.systemMessage).toContain('claude-mem');
  });

  it('keeps every other hook silent on stdout and failing loudly', () => {
    // Only SessionStart:context announces itself. PostToolUse fires on every
    // tool call; warning from there would spam a whole session.
    const { status, stdout } = runUnresolvable(commandAt('PostToolUse', 0, 0));
    expect(status).toBe(1);
    expect(stdout.trim()).toBe('');
  });

  it('appends rather than overwrites, so a run of failures is still countable', () => {
    const command = commandAt('PostToolUse', 0, 0);
    const cwd = join(root, 'cwd');
    mkdirSync(cwd, { recursive: true });
    runUnresolvable(command);
    const { dataDir } = runUnresolvable(command);
    expect(breadcrumbLines(dataDir).length).toBe(2);
  });
});

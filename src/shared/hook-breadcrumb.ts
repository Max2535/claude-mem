/**
 * hook-breadcrumb.ts — the read side of the hook-resolution breadcrumb.
 *
 * When a hook's shell prelude cannot resolve the plugin root it exits before
 * Node ever runs, so nothing in this codebase can log the failure, and Claude
 * Code discards hook stderr. The prelude therefore appends one line to a plain
 * text file (see `shellBreadcrumbClause` in src/build/hook-shell-template.ts);
 * this module reads it back on the next session that DOES resolve, so the gap
 * is reported instead of silently swallowed.
 *
 * That is not hypothetical: seven sessions under ~/swift were dropped across
 * five weeks and the only surviving evidence was the raw error text embedded in
 * the Claude Code transcripts.
 *
 * Line format, tab separated: `<ISO-8601 UTC>\t<cwd>\t<site>`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { DATA_DIR } from './paths.js';
import { logger } from '../utils/logger.js';

export const BREADCRUMB_FILENAME = 'hook-resolution-failures.log';

/** Cap on lines parsed. A permanently broken install writes one per tool call. */
const MAX_LINES = 5000;

export interface HookFailureEntry {
  at: string;
  cwd: string;
  site: string;
}

export interface HookFailureReport {
  entries: HookFailureEntry[];
  /** Distinct `<date>|<cwd>` pairs — the closest honest proxy for "sessions lost". */
  occasions: number;
  directories: string[];
  firstAt: string;
  lastAt: string;
}

/**
 * The shell prelude honours only $CLAUDE_MEM_DATA_DIR, never a data dir set in
 * settings.json — parsing JSON in a failing prelude is more fragile than the
 * breadcrumb is worth. So the reader checks the resolved data dir AND the
 * default, or a user with a relocated data dir would never see their own
 * breadcrumbs.
 */
export function breadcrumbPaths(): string[] {
  const fallback = join(homedir(), '.claude-mem', BREADCRUMB_FILENAME);
  const configured = join(DATA_DIR, BREADCRUMB_FILENAME);
  return configured === fallback ? [configured] : [configured, fallback];
}

function parseLine(line: string): HookFailureEntry | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const [at, cwd, site] = parts;
  if (!at || !site) return null;
  return { at, cwd: cwd || '(unknown)', site };
}

export function readHookFailures(paths: string[] = breadcrumbPaths()): HookFailureReport | null {
  const entries: HookFailureEntry[] = [];
  for (const path of paths) {
    let raw: string;
    try {
      if (!existsSync(path)) continue;
      raw = readFileSync(path, 'utf-8');
    } catch (error) {
      // An unreadable breadcrumb must never break context injection — the
      // whole point of this file is to report a failure, not to add one.
      logger.warn('HOOK', 'Hook-failure breadcrumb could not be read', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const entry = parseLine(trimmed);
      if (entry) entries.push(entry);
      if (entries.length >= MAX_LINES) break;
    }
  }
  if (entries.length === 0) return null;

  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const occasionKeys = new Set(entries.map(e => `${e.at.slice(0, 10)}|${e.cwd}`));
  const directories = Array.from(new Set(entries.map(e => e.cwd)));

  // The one place a dropped session is ever named. Logged as well as rendered
  // so the record survives even if the user never reads the injected context.
  logger.warn('HOOK', 'Hook resolution failed while this session was not running', {
    occasions: occasionKeys.size,
    directories: directories.length,
    firstAt: entries[0]!.at,
    lastAt: entries[entries.length - 1]!.at,
  });

  return {
    entries,
    occasions: occasionKeys.size,
    directories,
    firstAt: entries[0]!.at,
    lastAt: entries[entries.length - 1]!.at,
  };
}

export function renderHookFailureWarning(report: HookFailureReport): string {
  const days = Array.from(new Set(report.entries.map(e => e.at.slice(0, 10))));
  const span = days.length === 1 ? days[0] : `${report.firstAt.slice(0, 10)} → ${report.lastAt.slice(0, 10)}`;
  const dirs = report.directories.slice(0, 5);
  const more = report.directories.length - dirs.length;
  const dirList = dirs.map(d => `  - ${d}`).join('\n');
  return [
    '⚠️ claude-mem hooks failed to start and nothing was recorded for those sessions.',
    `${report.occasions} occasion${report.occasions === 1 ? '' : 's'} across ${span}, in:`,
    dirList + (more > 0 ? `\n  - …and ${more} more` : ''),
    'Those sessions have no memory. This notice clears once reported.',
  ].join('\n');
}

/** Non-destructive: prepends the report when there is one. */
export function withHookFailureWarning(text: string): string {
  const report = readHookFailures();
  if (!report) return text;
  const warning = renderHookFailureWarning(report);
  return text ? `${warning}\n\n${text}` : warning;
}

/**
 * Called only from the SessionStart inject path, after the context carrying the
 * warning has been handed back. Other readers (the viewer, `--full`) render the
 * same warning but must not consume it, or the one surface the user actually
 * reads at session start would find the file already empty.
 */
export function clearHookFailures(paths: string[] = breadcrumbPaths()): void {
  for (const path of paths) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Best effort. A stale breadcrumb repeats the warning next session, which
      // is strictly better than throwing inside a hook response.
    }
  }
}

/** Test seam: write a breadcrumb the way the shell prelude does. */
export function appendHookFailure(entry: HookFailureEntry, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${entry.at}\t${entry.cwd}\t${entry.site}\n`);
}

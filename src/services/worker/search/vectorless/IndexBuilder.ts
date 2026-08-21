import { normalizePlatformSource } from '../../../../shared/platform-source.js';
import { logger } from '../../../../utils/logger.js';
import type { ObservationSearchResult } from '../types.js';

const SAMPLE_TITLES_PER_DAY = 5;

export interface DayIndexEntry {
  day: string;
  count: number;
  sessions: string[];
  sources: string[];
  sampleTitles: string[];
}

export function dayOf(row: ObservationSearchResult): string {
  return (row.created_at ?? '').slice(0, 10);
}

function sourceOf(row: ObservationSearchResult): string {
  return normalizePlatformSource((row as { platform_source?: string }).platform_source);
}

export function buildDayIndex(rows: ObservationSearchResult[]): DayIndexEntry[] {
  const byDay = new Map<string, ObservationSearchResult[]>();
  for (const row of rows) {
    const day = dayOf(row);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(row);
  }
  logger.debug('SEARCH', 'IndexBuilder: built day index', {
    rows: rows.length,
    days: byDay.size,
  });
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayRows]) => ({
      day,
      count: dayRows.length,
      sessions: [...new Set(dayRows.map(r => r.memory_session_id))],
      sources: [...new Set(dayRows.map(sourceOf))],
      sampleTitles: dayRows.slice(0, SAMPLE_TITLES_PER_DAY).map(r => r.title ?? '(untitled)'),
    }));
}

export function renderDayIndex(days: DayIndexEntry[]): string {
  return days
    .map(d => `${d.day} | ${d.count} obs | sessions: ${d.sessions.length} | sources: ${d.sources.join(',')} | e.g. ${d.sampleTitles.map(t => `"${t}"`).join(', ')}`)
    .join('\n');
}

export function renderObservationIndex(rows: ObservationSearchResult[]): string {
  return rows
    .map(r => `[${r.id}] ${dayOf(r)} ${r.type} (${sourceOf(r)}) ${r.title ?? '(untitled)'}`)
    .join('\n');
}

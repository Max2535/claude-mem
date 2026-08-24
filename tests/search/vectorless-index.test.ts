import { describe, test, expect } from 'bun:test';
import { buildDayIndex, renderDayIndex, renderObservationIndex, dayOf } from '../../src/services/worker/search/vectorless/IndexBuilder.js';
import type { ObservationSearchResult } from '../../src/services/worker/search/types.js';

function obs(id: number, created_at: string, extra: Partial<ObservationSearchResult> = {}): ObservationSearchResult {
  return {
    id,
    memory_session_id: extra.memory_session_id ?? `s-${id}`,
    project: 'demo',
    text: null,
    type: 'discovery',
    title: extra.title ?? `obs ${id}`,
    subtitle: null,
    facts: null,
    narrative: null,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: null,
    discovery_tokens: 0,
    created_at,
    created_at_epoch: 0,
    ...extra,
  } as ObservationSearchResult;
}

describe('IndexBuilder', () => {
  const rows = [
    obs(3, '2026-08-19 09:00:00', { memory_session_id: 'sess-b', title: 'fix worker restart' }),
    obs(2, '2026-08-18 15:00:00', { memory_session_id: 'sess-a', title: 'chroma sync retry' }),
    obs(1, '2026-08-18 10:00:00', { memory_session_id: 'sess-a', title: 'schema migration' }),
  ];

  test('dayOf slices date part', () => {
    expect(dayOf(rows[0])).toBe('2026-08-19');
  });

  test('buildDayIndex groups by day, newest first, distinct sessions', () => {
    const days = buildDayIndex(rows);
    expect(days.map(d => d.day)).toEqual(['2026-08-19', '2026-08-18']);
    expect(days[1].count).toBe(2);
    expect(days[1].sessions).toEqual(['sess-a']);
    expect(days[1].sampleTitles).toEqual(['chroma sync retry', 'schema migration']);
  });

  test('renderDayIndex emits one line per day with counts', () => {
    const text = renderDayIndex(buildDayIndex(rows));
    expect(text).toContain('2026-08-18 | 2 obs | sessions: 1 | sources: claude');
    expect(text).toContain('chroma sync retry');
  });

  test('renderObservationIndex emits [id] day title lines', () => {
    const text = renderObservationIndex(rows);
    expect(text).toContain('[3] 2026-08-19 discovery (claude) fix worker restart');
  });
});

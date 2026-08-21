import { describe, test, expect } from 'bun:test';
import { TraversalAgent, parseTraversalResponse } from '../../src/services/worker/search/vectorless/TraversalAgent.js';

describe('parseTraversalResponse', () => {
  test('parses bare JSON', () => {
    expect(parseTraversalResponse('{"days":["2026-08-18"]}')).toEqual({ days: ['2026-08-18'] });
  });

  test('parses fenced JSON with prose around it', () => {
    const text = 'Picking these:\n```json\n{"ids": [3, 1]}\n```\ndone';
    expect(parseTraversalResponse(text)).toEqual({ ids: [3, 1] });
  });

  test('throws when no JSON present', () => {
    expect(() => parseTraversalResponse('no idea')).toThrow('No JSON object in LLM response');
  });
});

describe('TraversalAgent', () => {
  test('selectDays returns parsed days capped at maxDays', async () => {
    const agent = new TraversalAgent(async () => '{"days":["2026-08-19","2026-08-18","2026-08-17"]}');
    const days = await agent.selectDays('worker restart bug', 'INDEX', 2);
    expect(days).toEqual(['2026-08-19', '2026-08-18']);
  });

  test('selectObservations returns numeric ids capped at limit', async () => {
    const agent = new TraversalAgent(async () => '{"ids":[3,1,2]}');
    const ids = await agent.selectObservations('worker restart bug', 'INDEX', 2);
    expect(ids).toEqual([3, 1]);
  });

  test('prompt includes query and index text', async () => {
    let seen = '';
    const agent = new TraversalAgent(async (p) => { seen = p; return '{"ids":[]}'; });
    await agent.selectObservations('my query', 'MY-INDEX', 5);
    expect(seen).toContain('my query');
    expect(seen).toContain('MY-INDEX');
  });
});

import { describe, expect, it } from 'bun:test';
import {
  AGENT_FLOW_BUFFER_SIZE,
  AgentFlowBuffer,
  type AgentFlowEventInput,
} from '../../src/services/worker/events/AgentFlowBuffer.js';

function input(overrides: Partial<AgentFlowEventInput> = {}): AgentFlowEventInput {
  return {
    stage: 'hook_received',
    project: 'demo',
    contentSessionId: 'cs-1',
    sessionDbId: null,
    detail: 'observation',
    outcome: 'ok',
    ...overrides,
  };
}

describe('AgentFlowBuffer', () => {
  it('assigns strictly increasing seq numbers', () => {
    const buffer = new AgentFlowBuffer();
    const a = buffer.record(input());
    const b = buffer.record(input());
    const c = buffer.record(input());

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
  });

  it('keeps seq increasing after eviction so replay never reuses a key', () => {
    const buffer = new AgentFlowBuffer(3);
    for (let i = 0; i < 5; i++) buffer.record(input());

    const backlog = buffer.backlog();
    expect(backlog.map(e => e.seq)).toEqual([3, 4, 5]);
  });

  it('evicts oldest first and never exceeds capacity', () => {
    const buffer = new AgentFlowBuffer(2);
    buffer.record(input({ detail: 'first' }));
    buffer.record(input({ detail: 'second' }));
    buffer.record(input({ detail: 'third' }));

    expect(buffer.size()).toBe(2);
    expect(buffer.backlog().map(e => e.detail)).toEqual(['second', 'third']);
  });

  it('returns the backlog oldest first', () => {
    const buffer = new AgentFlowBuffer();
    buffer.record(input({ at: 100 }));
    buffer.record(input({ at: 200 }));

    expect(buffer.backlog().map(e => e.at)).toEqual([100, 200]);
  });

  it('hands out a copy so a caller cannot mutate the ring', () => {
    const buffer = new AgentFlowBuffer();
    buffer.record(input());

    const backlog = buffer.backlog();
    backlog.pop();

    expect(buffer.size()).toBe(1);
  });

  it('defaults to a capacity that survives a busy session', () => {
    const buffer = new AgentFlowBuffer();
    for (let i = 0; i < AGENT_FLOW_BUFFER_SIZE + 10; i++) buffer.record(input());

    expect(buffer.size()).toBe(AGENT_FLOW_BUFFER_SIZE);
  });
});

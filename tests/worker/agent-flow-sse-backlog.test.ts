import { describe, expect, it } from 'bun:test';
import type { Response } from 'express';
import { SSEBroadcaster } from '../../src/services/worker/SSEBroadcaster.js';

/** Minimal express Response stand-in: SSEBroadcaster only writes and listens. */
function fakeClient() {
  const writes: string[] = [];
  const res = {
    writes,
    write(chunk: string) { writes.push(chunk); return true; },
    on(_event: string, _cb: () => void) { return res; },
  };
  return res as unknown as Response & { writes: string[] };
}

function parsed(client: { writes: string[] }): Array<Record<string, unknown>> {
  return client.writes
    .join('')
    .split('\n\n')
    .filter(Boolean)
    .map(chunk => JSON.parse(chunk.replace(/^data: /, '')));
}

const event = {
  stage: 'observation_written' as const,
  project: 'demo',
  contentSessionId: 'cs-1',
  sessionDbId: null,
  detail: 'discovery',
  outcome: 'ok' as const,
};

describe('SSEBroadcaster agent flow', () => {
  it('records events even with nobody connected, then replays them on connect', () => {
    const broadcaster = new SSEBroadcaster();
    broadcaster.emitFlow(event);
    broadcaster.emitFlow(event);

    const client = fakeClient();
    broadcaster.addClient(client);

    const messages = parsed(client);
    expect(messages[0].type).toBe('connected');
    expect(messages[1].type).toBe('flow_backlog');
    expect((messages[1].events as unknown[]).length).toBe(2);
  });

  it('sends no backlog frame when the ring is empty', () => {
    const broadcaster = new SSEBroadcaster();
    const client = fakeClient();
    broadcaster.addClient(client);

    expect(parsed(client).map(m => m.type)).toEqual(['connected']);
  });

  it('replays before any live event, so seq order across the two is total', () => {
    const broadcaster = new SSEBroadcaster();
    const first = broadcaster.emitFlow(event);

    const client = fakeClient();
    broadcaster.addClient(client);
    const second = broadcaster.emitFlow(event);

    const messages = parsed(client);
    const backlogIndex = messages.findIndex(m => m.type === 'flow_backlog');
    const liveIndex = messages.findIndex(m => m.type === 'flow_event');

    expect(backlogIndex).toBeLessThan(liveIndex);
    expect(second.seq).toBeGreaterThan(first.seq);
    expect((messages[liveIndex].event as { seq: number }).seq).toBe(second.seq);
  });

  it('pushes live events to every connected client', () => {
    const broadcaster = new SSEBroadcaster();
    const a = fakeClient();
    const b = fakeClient();
    broadcaster.addClient(a);
    broadcaster.addClient(b);

    broadcaster.emitFlow(event);

    for (const client of [a, b]) {
      expect(parsed(client).some(m => m.type === 'flow_event')).toBe(true);
    }
  });

  it('keeps flow events off the ordinary broadcast channel', () => {
    const broadcaster = new SSEBroadcaster();
    const client = fakeClient();
    broadcaster.addClient(client);
    client.writes.length = 0;

    broadcaster.emitFlow(event);

    expect(parsed(client).map(m => m.type)).toEqual(['flow_event']);
  });
});

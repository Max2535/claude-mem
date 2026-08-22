import { describe, it, expect } from 'bun:test';
import { createLatestRequest } from '../../src/ui/viewer/utils/latestRequest';

/**
 * The Explorer refetches on every project change, every date step and once a
 * second while capture is running (useExplorerDay.ts). Those responses do not
 * have to come back in the order they were asked for.
 */
describe('createLatestRequest', () => {
  it('treats the first request as current until another starts', () => {
    const request = createLatestRequest();
    const first = request.start();

    expect(first.isCurrent()).toBe(true);
  });

  it('drops an earlier request the moment a newer one starts', () => {
    const request = createLatestRequest();
    const first = request.start();
    const second = request.start();

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('aborts the earlier request rather than leaving it running', () => {
    const request = createLatestRequest();
    const first = request.start();
    expect(first.signal.aborted).toBe(false);

    request.start();

    expect(first.signal.aborted).toBe(true);
  });

  it('leaves the newest request unaborted', () => {
    const request = createLatestRequest();
    request.start();
    const second = request.start();

    expect(second.signal.aborted).toBe(false);
  });

  it('makes nothing current after cancel, so an unmounted view sets no state', () => {
    const request = createLatestRequest();
    const only = request.start();

    request.cancel();

    expect(only.isCurrent()).toBe(false);
    expect(only.signal.aborted).toBe(true);
  });

  it('survives a cancel with nothing in flight', () => {
    const request = createLatestRequest();

    expect(() => request.cancel()).not.toThrow();
    expect(request.start().isCurrent()).toBe(true);
  });

  it('keeps only the last of a burst current', () => {
    const request = createLatestRequest();
    const tickets = Array.from({ length: 5 }, () => request.start());

    expect(tickets.filter(t => t.isCurrent()).length).toBe(1);
    expect(tickets[4].isCurrent()).toBe(true);
  });

  // The actual failure this exists to stop: an out-of-order response.
  it('lets the newest response win even when an older one resolves last', async () => {
    const request = createLatestRequest();
    const applied: string[] = [];

    const run = async (label: string, delayMs: number) => {
      const ticket = request.start();
      await new Promise(resolve => setTimeout(resolve, delayMs));
      if (!ticket.isCurrent()) return;
      applied.push(label);
    };

    const slowFirst = run('day-1', 30);
    await new Promise(resolve => setTimeout(resolve, 5));
    const fastSecond = run('day-2', 1);
    await Promise.all([slowFirst, fastSecond]);

    expect(applied).toEqual(['day-2']);
  });

  it('reports an abort as not-current so it is not rendered as an error', async () => {
    const request = createLatestRequest();
    const ticket = request.start();
    const aborted = new Promise<boolean>(resolve => {
      ticket.signal.addEventListener('abort', () => resolve(ticket.isCurrent()));
    });

    request.start();

    expect(await aborted).toBe(false);
  });
});

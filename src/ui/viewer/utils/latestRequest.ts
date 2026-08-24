/**
 * Last-write-wins guard for a component that refetches faster than the server
 * answers. Two fetches started a second apart can come back in either order,
 * and the loser overwriting the winner shows the reader a day they already
 * navigated away from.
 *
 * Kept out of the hook so the ordering can be tested without a DOM: React only
 * ever calls start() and cancel().
 */

export interface RequestTicket {
  /** Pass to fetch. Aborted as soon as a newer request starts. */
  signal: AbortSignal;
  /**
   * True only for the newest request still in flight. Check it after every
   * await — a response that arrives late must be dropped, not rendered, and an
   * abort must not be reported as a failure.
   */
  isCurrent(): boolean;
}

export interface LatestRequest {
  start(): RequestTicket;
  /** Abandons whatever is in flight. Nothing started before this is current. */
  cancel(): void;
}

export function createLatestRequest(): LatestRequest {
  let sequence = 0;
  let inFlight: AbortController | null = null;

  return {
    start(): RequestTicket {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const mine = ++sequence;
      return {
        signal: controller.signal,
        isCurrent: () => mine === sequence && !controller.signal.aborted,
      };
    },

    cancel(): void {
      inFlight?.abort();
      inFlight = null;
      // Bumped so a request that was already awaiting its response stops being
      // current even though nothing new replaced it.
      sequence += 1;
    },
  };
}

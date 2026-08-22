import { describe, test, expect } from 'bun:test';
import {
  createVectorlessLlmRunner,
  type VectorlessLlmDeps,
} from '../../src/services/worker/search/vectorless/llm-runner.js';
import type { SlotReservation } from '../../src/supervisor/process-registry.js';

/**
 * These cover the parts of runVectorlessLlm that are not the subprocess: the
 * slot gate, the timeout, and the promise that the slot is released on every
 * exit path. The production wiring (waitForSlot + the hardened SDK query) is
 * `productionVectorlessLlmDeps`; only that is untested here, and it is
 * declaration, not logic.
 */

function assistant(text: string) {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } };
}

/** Records slot lifecycle so a test can assert ordering, not just counts. */
function slotTracker() {
  const events: string[] = [];
  let held = 0;
  return {
    events,
    maxHeld: () => Math.max(0, ...events.map(() => held)),
    heldNow: () => held,
    acquire: async (): Promise<SlotReservation> => {
      held += 1;
      events.push('acquire');
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          held -= 1;
          events.push('release');
        },
      };
    },
  };
}

function makeDeps(overrides: Partial<VectorlessLlmDeps> = {}): VectorlessLlmDeps {
  return {
    acquireSlot: async () => ({ release() {} }),
    runQuery: async function* () {
      yield assistant('ok');
    },
    ...overrides,
  };
}

describe('createVectorlessLlmRunner', () => {
  test('returns the text of the last assistant message', async () => {
    const run = createVectorlessLlmRunner(makeDeps({
      runQuery: async function* () {
        yield assistant('first');
        yield { type: 'system' };
        yield assistant('second');
      },
    }));

    expect(await run('prompt')).toBe('second');
  });

  test('joins every text block in a message and ignores non-text blocks', async () => {
    const run = createVectorlessLlmRunner(makeDeps({
      runQuery: async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'a' },
              { type: 'tool_use', name: 'Read' },
              { type: 'text', text: 'b' },
            ],
          },
        };
      },
    }));

    expect(await run('prompt')).toBe('ab');
  });

  test('takes a slot before running the query and releases it after', async () => {
    const slots = slotTracker();
    const run = createVectorlessLlmRunner(makeDeps({
      acquireSlot: slots.acquire,
      runQuery: async function* () {
        // The slot must already be held while the subprocess would be alive.
        expect(slots.heldNow()).toBe(1);
        slots.events.push('query');
        yield assistant('ok');
      },
    }));

    await run('prompt');

    expect(slots.events).toEqual(['acquire', 'query', 'release']);
    expect(slots.heldNow()).toBe(0);
  });

  test('releases the slot when the query throws', async () => {
    const slots = slotTracker();
    const run = createVectorlessLlmRunner(makeDeps({
      acquireSlot: slots.acquire,
      runQuery: async function* () {
        throw new Error('spawn failed');
        yield assistant('unreachable');
      },
    }));

    await expect(run('prompt')).rejects.toThrow('spawn failed');
    // A leaked reservation would occupy the slot until the worker restarts.
    expect(slots.heldNow()).toBe(0);
  });

  test('tolerates the SDK process dying after the answer arrived', async () => {
    const slots = slotTracker();
    const run = createVectorlessLlmRunner(makeDeps({
      acquireSlot: slots.acquire,
      runQuery: async function* () {
        yield assistant('answered');
        throw new Error('process exited with code 1');
      },
    }));

    expect(await run('prompt')).toBe('answered');
    expect(slots.heldNow()).toBe(0);
  });

  test('times out a hung query instead of blocking the HTTP caller forever', async () => {
    const slots = slotTracker();
    let sawAbort = false;
    const run = createVectorlessLlmRunner(makeDeps({
      timeoutMs: 20,
      acquireSlot: slots.acquire,
      runQuery: async function* (_prompt, abortController) {
        await new Promise<void>((resolve) => {
          abortController.signal.addEventListener('abort', () => {
            sawAbort = true;
            resolve();
          });
        });
        // A real SDK stream ends without an answer once aborted.
      },
    }));

    await expect(run('prompt')).rejects.toThrow('Vectorless traversal timed out after 20ms');
    expect(sawAbort).toBe(true);
    expect(slots.heldNow()).toBe(0);
  });

  test('an empty answer with no abort is returned as empty, not as a timeout', async () => {
    const run = createVectorlessLlmRunner(makeDeps({
      timeoutMs: 5_000,
      runQuery: async function* () {
        yield { type: 'system' };
      },
    }));

    expect(await run('prompt')).toBe('');
  });

  test('clears the timer so a completed call cannot abort a later one', async () => {
    const controllers: AbortController[] = [];
    const run = createVectorlessLlmRunner(makeDeps({
      timeoutMs: 20,
      runQuery: async function* (_prompt, abortController) {
        controllers.push(abortController);
        yield assistant('fast');
      },
    }));

    await run('first');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(controllers[0].signal.aborted).toBe(false);
  });
});

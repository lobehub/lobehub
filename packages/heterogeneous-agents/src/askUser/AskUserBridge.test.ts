import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from './AskUserBridge';

describe('AskUserBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('pending() → resolve()', () => {
    it('emits an agent_intervention_request and resolves with the user-supplied result', async () => {
      const bridge = new AskUserBridge('op-1');
      const events: any[] = [];
      const iter = bridge.events()[Symbol.asyncIterator]();

      // Pump events asynchronously into the array.
      const pumped = (async () => {
        const e = await iter.next();
        if (!e.done) events.push(e.value);
      })();

      const pending = bridge.pending({ arguments: { questions: [{ q: 'foo' }] } });
      await pumped;

      expect(events).toHaveLength(1);
      const req = events[0];
      expect(req.type).toBe('agent_intervention_request');
      expect(req.operationId).toBe('op-1');
      expect(req.data.identifier).toBe('claude-code');
      expect(req.data.apiName).toBe('askUserQuestion');
      expect(req.data.toolCallId).toMatch(/^[\da-f-]{36}$/);
      expect(JSON.parse(req.data.arguments)).toEqual({ questions: [{ q: 'foo' }] });

      bridge.resolve(req.data.toolCallId, { result: { foo: 'bar' } });
      await expect(pending).resolves.toEqual({ result: { foo: 'bar' } });
    });

    it('uses caller-supplied toolCallId as the wire correlation key', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      const pending = bridge.pending({
        arguments: { questions: [] },
        toolCallId: 'cc-tool-use-abc',
      });
      const event = await drain.firstEvent;
      expect(event.data.toolCallId).toBe('cc-tool-use-abc');

      bridge.resolve('cc-tool-use-abc', { result: { picked: 'red' } });
      await expect(pending).resolves.toEqual({ result: { picked: 'red' } });
      drain.stop();
    });

    it('rejects pending() when the same toolCallId is already in flight', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      void bridge.pending({ arguments: {}, toolCallId: 'dup' });
      await expect(bridge.pending({ arguments: {}, toolCallId: 'dup' })).rejects.toThrow(
        /duplicate toolCallId/,
      );
      bridge.cancelAll();
      drain.stop();
    });

    it('ignores resolve() for unknown toolCallId', async () => {
      const bridge = new AskUserBridge('op-1');
      // Drain emitted events into the void so pending() can run.
      const drain = drainEvents(bridge);
      const pending = bridge.pending({ arguments: {} });

      bridge.resolve('not-a-real-id', { result: 'x' });

      // Promise should still be unresolved — fast-forward past timeout to confirm.
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      const answer = await pending;
      expect(answer.cancelled).toBe(true);
      expect(answer.cancelReason).toBe('timeout');
      drain.stop();
    });
  });

  describe('cancellation paths', () => {
    it('resolves with cancelled=true on user_cancelled via cancel()', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      const pending = bridge.pending({ arguments: {} });
      const toolCallId = (await drain.firstEvent).data.toolCallId;

      bridge.cancel(toolCallId);

      const answer = await pending;
      expect(answer).toEqual({ cancelReason: 'user_cancelled', cancelled: true });
      drain.stop();
    });

    it('resolves with cancelled=true on session_ended via cancelAll()', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      const pending = bridge.pending({ arguments: {} });
      await drain.firstEvent;

      bridge.cancelAll('session_ended');

      const answer = await pending;
      expect(answer).toEqual({ cancelReason: 'session_ended', cancelled: true });
      drain.stop();
    });

    it('resolves with cancelled=true on timeout (default 5 min)', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      const pending = bridge.pending({ arguments: {} });

      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      const stillPending = await Promise.race([pending, Promise.resolve('not-yet')]);
      expect(stillPending).toBe('not-yet');

      vi.advanceTimersByTime(2);
      const answer = await pending;
      expect(answer).toEqual({ cancelReason: 'timeout', cancelled: true });
      drain.stop();
    });

    it('honors a custom timeoutMs', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      const pending = bridge.pending({ arguments: {} }, { timeoutMs: 1000 });

      vi.advanceTimersByTime(1001);
      const answer = await pending;
      expect(answer.cancelled).toBe(true);
      drain.stop();
    });

    it('cancelAll() rejects future pending() calls', async () => {
      const bridge = new AskUserBridge('op-1');
      bridge.cancelAll();
      await expect(bridge.pending({ arguments: {} })).rejects.toThrow(/closed/);
    });
  });

  describe('progress notifications (keepalive)', () => {
    it('calls onProgress at the configured interval until resolved', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      const onProgress = vi.fn();
      const pending = bridge.pending(
        { arguments: {} },
        { onProgress, progressIntervalMs: 100, timeoutMs: 1000 },
      );
      const toolCallId = (await drain.firstEvent).data.toolCallId;

      vi.advanceTimersByTime(350);
      // Three ticks elapsed (100, 200, 300) — Node's setInterval fires
      // exactly at multiples, so 3 calls with monotonically increasing
      // elapsed values.
      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress.mock.calls[0][0]).toBeGreaterThanOrEqual(100);
      expect(onProgress.mock.calls[2][0]).toBeGreaterThanOrEqual(300);
      expect(onProgress.mock.calls[0][1]).toBe(1000);

      bridge.resolve(toolCallId, { result: 'done' });
      await pending;

      // After resolve, no further ticks even after more time passes.
      vi.advanceTimersByTime(500);
      expect(onProgress).toHaveBeenCalledTimes(3);
      drain.stop();
    });

    it('skips onProgress entirely when not provided', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);
      // No onProgress — just verify timeout still works without it.
      const pending = bridge.pending({ arguments: {} }, { timeoutMs: 50 });
      vi.advanceTimersByTime(60);
      await expect(pending).resolves.toMatchObject({ cancelled: true });
      drain.stop();
    });
  });

  describe('event stream', () => {
    it('emits one request event per pending() call', async () => {
      const bridge = new AskUserBridge('op-1');
      const drain = drainEvents(bridge);

      bridge.pending({ arguments: { q: 1 } });
      bridge.pending({ arguments: { q: 2 } });
      bridge.pending({ arguments: { q: 3 } });

      // Advance timers so the resolved-via-cancellation cleanup paths don't
      // interfere with the assertion below.
      const events = await Promise.all([
        drain.firstEvent,
        drain.events.next(),
        drain.events.next(),
      ]);
      // first 3 events are all intervention requests
      const types = events.map((e: any) => e.value?.type ?? e.type);
      expect(types.every((t) => t === 'agent_intervention_request')).toBe(true);

      bridge.cancelAll();
      drain.stop();
    });

    it('stamps stepIndex via the configured getter', async () => {
      let step = 7;
      const bridge = new AskUserBridge('op-1', { getStepIndex: () => step });
      const drain = drainEvents(bridge);

      bridge.pending({ arguments: {} });
      const e1 = await drain.firstEvent;
      expect(e1.stepIndex).toBe(7);

      step = 11;
      bridge.pending({ arguments: {} });
      const e2 = await drain.events.next();
      expect((e2.value as any).stepIndex).toBe(11);

      bridge.cancelAll();
    });

    it('iterator ends after cancelAll()', async () => {
      const bridge = new AskUserBridge('op-1');
      const iter = bridge.events()[Symbol.asyncIterator]();
      const next = iter.next();
      bridge.cancelAll();
      await expect(next).resolves.toMatchObject({ done: true });
    });
  });
});

// Helper: drain events from a bridge in the background, exposing the first
// emitted event as a promise and a way to call iter.next() on demand.
const drainEvents = (bridge: AskUserBridge) => {
  const events = bridge.events()[Symbol.asyncIterator]();
  const firstEvent = events.next().then((r) => {
    if (r.done) throw new Error('stream ended before first event');
    return r.value as any;
  });
  let stopped = false;
  return {
    events,
    firstEvent,
    stop: () => {
      stopped = true;
    },
    get stopped() {
      return stopped;
    },
  };
};

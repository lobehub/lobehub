import { describe, expect, it, vi } from 'vitest';

import { InMemoryStreamEventManager } from '../InMemoryStreamEventManager';
import type { StreamEvent } from '../StreamEventManager';

describe('InMemoryStreamEventManager', () => {
  let manager: InMemoryStreamEventManager;

  beforeEach(() => {
    manager = new InMemoryStreamEventManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('publishStreamEvent', () => {
    it('should publish and store events', async () => {
      const eventId = await manager.publishStreamEvent('op-1', {
        data: { msg: 'hello' },
        stepIndex: 0,
        type: 'agent_runtime_init',
      });

      expect(eventId).toBeDefined();
      const events = manager.getAllEvents('op-1');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent_runtime_init');
    });

    it('should notify subscribers on publish', async () => {
      const callback = vi.fn();
      manager.subscribe('op-1', callback);

      await manager.publishStreamEvent('op-1', {
        data: { msg: 'hello' },
        stepIndex: 0,
        type: 'agent_runtime_init',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'agent_runtime_init' })]),
      );
    });
  });

  describe('readEventsOnce', () => {
    it("returns nothing but a tail cursor for '$' (from-now semantics)", async () => {
      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'agent_runtime_init',
      });

      const { events, lastEventId } = await manager.readEventsOnce('op-1', '$');
      expect(events).toHaveLength(0);
      // Cursor points at the current tail so the next poll reads strictly forward.
      expect(lastEventId).not.toBe('$');
    });

    it('returns events after the cursor and advances it', async () => {
      const firstId = await manager.publishStreamEvent('op-1', {
        data: { n: 1 },
        stepIndex: 0,
        type: 'agent_runtime_init',
      });
      await manager.publishStreamEvent('op-1', {
        data: { result: { a: 1 }, toolCallId: 't1' },
        stepIndex: 1,
        type: 'agent_intervention_response',
      });

      const { events, lastEventId } = await manager.readEventsOnce('op-1', firstId);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent_intervention_response');
      expect(events[0].data).toMatchObject({ toolCallId: 't1' });
      expect(lastEventId).toBe(events[0].id);
    });

    it('is empty with an unchanged cursor when nothing is newer', async () => {
      const id = await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'agent_runtime_init',
      });
      const { events, lastEventId } = await manager.readEventsOnce('op-1', id);
      expect(events).toHaveLength(0);
      expect(lastEventId).toBe(id);
    });

    it("returns empty with a '0' cursor for an unknown operation", async () => {
      const { events, lastEventId } = await manager.readEventsOnce('nope', '$');
      expect(events).toHaveLength(0);
      expect(lastEventId).toBe('0');
    });
  });

  it('retains and paginates the complete history beyond the old 1000-event cap', async () => {
    await manager.publishAgentRuntimeInit('op-1', {});
    for (let n = 0; n < 1200; n++)
      await manager.publishStreamEvent('op-1', { data: { n }, stepIndex: 0, type: 'stream_chunk' });
    expect(manager.getAllEvents('op-1')).toHaveLength(1201);
    let cursor = '0';
    const ids: string[] = [];
    let hasMore = true;
    while (hasMore) {
      const page = await manager.getStreamHistoryPage('op-1', cursor, 200);
      expect(page.available).toBe(true);
      ids.push(...page.events.map((event) => event.id!));
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }
    expect(ids).toHaveLength(1201);
    expect(new Set(ids).size).toBe(1201);
    expect((await manager.getStreamHistoryPage('op-1', cursor)).events).toEqual([]);
    expect((await manager.getStreamHistoryPage('op-1', 'missing')).available).toBe(false);
  });

  it('reports history unavailable after the two-hour retention window', async () => {
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1000);
      await manager.publishAgentRuntimeInit('op-1', {});
      now.mockReturnValue(1000 + 2 * 3600 * 1000 + 1);
      expect((await manager.getStreamHistoryPage('op-1')).available).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  describe('subscribe', () => {
    it('should return an unsubscribe function', async () => {
      const callback = vi.fn();
      const unsubscribe = manager.subscribe('op-1', callback);

      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'agent_runtime_init',
      });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 1,
        type: 'agent_runtime_end',
      });
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribeStreamEvents', () => {
    it('should resolve when agent_runtime_end event is received', async () => {
      const receivedEvents: StreamEvent[] = [];

      const subscribePromise = manager.subscribeStreamEvents('op-1', '0', (events) => {
        receivedEvents.push(...events);
      });

      // Publish some events
      await manager.publishStreamEvent('op-1', {
        data: { status: 'running' },
        stepIndex: 0,
        type: 'agent_runtime_init',
      });

      await manager.publishStreamEvent('op-1', {
        data: { status: 'done' },
        stepIndex: 1,
        type: 'agent_runtime_end',
      });

      await subscribePromise;

      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0].type).toBe('agent_runtime_init');
      expect(receivedEvents[1].type).toBe('agent_runtime_end');
    });

    it('should resolve immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const receivedEvents: StreamEvent[] = [];

      await manager.subscribeStreamEvents(
        'op-1',
        '0',
        (events) => {
          receivedEvents.push(...events);
        },
        controller.signal,
      );

      expect(receivedEvents).toHaveLength(0);
    });

    it('should resolve when signal is aborted', async () => {
      const controller = new AbortController();
      const receivedEvents: StreamEvent[] = [];

      const subscribePromise = manager.subscribeStreamEvents(
        'op-1',
        '0',
        (events) => {
          receivedEvents.push(...events);
        },
        controller.signal,
      );

      await manager.publishStreamEvent('op-1', {
        data: { status: 'running' },
        stepIndex: 0,
        type: 'agent_runtime_init',
      });

      controller.abort();

      await subscribePromise;

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('agent_runtime_init');
    });
  });

  describe('clear', () => {
    it('should clear all stored events and subscribers', async () => {
      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'agent_runtime_init',
      });

      expect(manager.getAllEvents('op-1')).toHaveLength(1);

      manager.clear();

      expect(manager.getAllEvents('op-1')).toHaveLength(0);
    });
  });

  // agent_runtime_end optionally carries the canonical UIChatMessage[]
  // snapshot so the client can use the pushed payload as Source of Truth
  // instead of refetching from DB.
  describe('publishAgentRuntimeEnd uiMessages', () => {
    it('includes uiMessages in event data when provided', async () => {
      const uiMessages = [
        { id: 'msg_u', role: 'user' },
        { id: 'msg_a', role: 'assistantGroup' },
      ] as any[];
      const finalState = { status: 'done', stepCount: 3 };

      await manager.publishAgentRuntimeEnd({
        finalState,
        operationId: 'op-1',
        reason: 'done',
        stepIndex: 3,
        uiMessages,
      });

      const events = manager.getAllEvents('op-1');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent_runtime_end');
      expect(events[0].data.uiMessages).toEqual(uiMessages);
      expect(events[0].data.finalState).toEqual(finalState);
    });

    it('omits uiMessages when not provided (legacy callers stay unaffected)', async () => {
      const finalState = { status: 'done', stepCount: 3 };

      await manager.publishAgentRuntimeEnd({
        finalState,
        operationId: 'op-1',
        reason: 'done',
        stepIndex: 3,
      });

      const events = manager.getAllEvents('op-1');
      expect(events[0].data).not.toHaveProperty('uiMessages');
      expect(events[0].data.finalState).toEqual(finalState);
    });
  });
});

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
});

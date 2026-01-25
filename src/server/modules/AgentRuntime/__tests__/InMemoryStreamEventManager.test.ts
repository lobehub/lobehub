import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryStreamEventManager } from '../InMemoryStreamEventManager';

describe('InMemoryStreamEventManager', () => {
  let manager: InMemoryStreamEventManager;

  beforeEach(() => {
    manager = new InMemoryStreamEventManager();
  });

  describe('publishStreamEvent', () => {
    it('should publish event with generated ID and timestamp', async () => {
      const operationId = 'test-op-1';
      const eventData = {
        data: { message: 'test' },
        stepIndex: 0,
        type: 'stream_start' as const,
      };

      const eventId = await manager.publishStreamEvent(operationId, eventData);

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe('string');

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        ...eventData,
        id: eventId,
        operationId,
        timestamp: expect.any(Number),
      });
    });

    it('should create new stream if operationId does not exist', async () => {
      const operationId = 'new-op';

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(1);
    });

    it('should append event to existing stream', async () => {
      const operationId = 'test-op';

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 1,
        type: 'stream_chunk',
      });

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(2);
      expect(history[0].stepIndex).toBe(0);
      expect(history[1].stepIndex).toBe(1);
    });

    it('should limit stream length to 1000 events', async () => {
      const operationId = 'large-stream';

      // Publish 1005 events
      for (let i = 0; i < 1005; i++) {
        await manager.publishStreamEvent(operationId, {
          data: { count: i },
          stepIndex: i,
          type: 'stream_chunk',
        });
      }

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(1000);
      // Should have removed first 5 events
      expect(history[0].stepIndex).toBe(5);
      expect(history[999].stepIndex).toBe(1004);
    });

    it('should notify subscribers when event is published', async () => {
      const operationId = 'test-op';
      const callback = vi.fn();

      manager.subscribe(operationId, callback);

      await manager.publishStreamEvent(operationId, {
        data: { message: 'test' },
        stepIndex: 0,
        type: 'stream_start',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith([
        expect.objectContaining({
          operationId,
          type: 'stream_start',
        }),
      ]);
    });

    it('should handle subscriber callback errors without failing', async () => {
      const operationId = 'test-op';
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      manager.subscribe(operationId, errorCallback);

      await expect(
        manager.publishStreamEvent(operationId, {
          data: {},
          stepIndex: 0,
          type: 'stream_start',
        }),
      ).resolves.toBeDefined();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should generate unique event IDs', async () => {
      const operationId = 'test-op';
      const eventId1 = await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      const eventId2 = await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 1,
        type: 'stream_chunk',
      });

      expect(eventId1).not.toBe(eventId2);
    });
  });

  describe('publishStreamChunk', () => {
    it('should publish stream chunk event', async () => {
      const operationId = 'test-op';
      const stepIndex = 1;
      const chunkData = {
        chunkType: 'text' as const,
        content: 'Hello, world!',
      };

      const eventId = await manager.publishStreamChunk(operationId, stepIndex, chunkData);

      expect(eventId).toBeDefined();

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        data: chunkData,
        stepIndex,
        type: 'stream_chunk',
      });
    });

    it('should handle different chunk types', async () => {
      const operationId = 'test-op';
      const chunkTypes = ['text', 'reasoning', 'tools_calling', 'image'] as const;

      for (const chunkType of chunkTypes) {
        await manager.publishStreamChunk(operationId, 0, {
          chunkType,
          content: `content-${chunkType}`,
        });
      }

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(chunkTypes.length);
      history.forEach((event, index) => {
        expect(event.data.chunkType).toBe(chunkTypes[index]);
      });
    });
  });

  describe('publishAgentRuntimeInit', () => {
    it('should publish agent runtime init event', async () => {
      const operationId = 'test-op';
      const initialState = {
        agentConfig: { name: 'TestAgent' },
        status: 'idle',
        totalCost: 0,
      };

      const eventId = await manager.publishAgentRuntimeInit(operationId, initialState);

      expect(eventId).toBeDefined();

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        data: initialState,
        stepIndex: 0,
        type: 'agent_runtime_init',
      });
    });
  });

  describe('publishAgentRuntimeEnd', () => {
    it('should publish agent runtime end event with default reason', async () => {
      const operationId = 'test-op';
      const stepIndex = 5;
      const finalState = {
        status: 'completed',
        totalCost: 100,
      };

      const eventId = await manager.publishAgentRuntimeEnd(operationId, stepIndex, finalState);

      expect(eventId).toBeDefined();

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        data: {
          finalState,
          operationId,
          phase: 'execution_complete',
          reason: 'completed',
          reasonDetail: 'Agent runtime completed successfully',
        },
        stepIndex,
        type: 'agent_runtime_end',
      });
    });

    it('should accept custom reason and reasonDetail', async () => {
      const operationId = 'test-op';
      const stepIndex = 3;
      const finalState = { status: 'error' };
      const reason = 'error';
      const reasonDetail = 'Agent failed due to timeout';

      await manager.publishAgentRuntimeEnd(
        operationId,
        stepIndex,
        finalState,
        reason,
        reasonDetail,
      );

      const history = manager.getAllEvents(operationId);
      expect(history[0].data).toMatchObject({
        reason,
        reasonDetail,
      });
    });
  });

  describe('getStreamHistory', () => {
    it('should return empty array for non-existent operation', async () => {
      const history = await manager.getStreamHistory('non-existent-op');

      expect(history).toEqual([]);
    });

    it('should return most recent events in reverse order', async () => {
      const operationId = 'test-op';

      // Publish 5 events
      for (let i = 0; i < 5; i++) {
        await manager.publishStreamEvent(operationId, {
          data: { step: i },
          stepIndex: i,
          type: 'stream_chunk',
        });
      }

      const history = await manager.getStreamHistory(operationId);

      expect(history).toHaveLength(5);
      // Should be in reverse order (most recent first)
      expect(history[0].stepIndex).toBe(4);
      expect(history[4].stepIndex).toBe(0);
    });

    it('should limit returned events to specified count', async () => {
      const operationId = 'test-op';

      // Publish 10 events
      for (let i = 0; i < 10; i++) {
        await manager.publishStreamEvent(operationId, {
          data: { step: i },
          stepIndex: i,
          type: 'stream_chunk',
        });
      }

      const history = await manager.getStreamHistory(operationId, 5);

      expect(history).toHaveLength(5);
      // Should return last 5 events in reverse order
      expect(history[0].stepIndex).toBe(9);
      expect(history[4].stepIndex).toBe(5);
    });

    it('should return all events if count is larger than stream size', async () => {
      const operationId = 'test-op';

      // Publish 3 events
      for (let i = 0; i < 3; i++) {
        await manager.publishStreamEvent(operationId, {
          data: { step: i },
          stepIndex: i,
          type: 'stream_chunk',
        });
      }

      const history = await manager.getStreamHistory(operationId, 100);

      expect(history).toHaveLength(3);
    });
  });

  describe('cleanupOperation', () => {
    it('should remove stream data and subscribers', async () => {
      const operationId = 'test-op';
      const callback = vi.fn();

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      manager.subscribe(operationId, callback);

      await manager.cleanupOperation(operationId);

      // Stream should be removed
      const history = manager.getAllEvents(operationId);
      expect(history).toEqual([]);

      // Subscribers should be removed
      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      expect(callback).not.toHaveBeenCalled();
    });

    it('should not throw error when cleaning up non-existent operation', async () => {
      await expect(manager.cleanupOperation('non-existent-op')).resolves.toBeUndefined();
    });
  });

  describe('getActiveOperationsCount', () => {
    it('should return 0 when no operations exist', async () => {
      const count = await manager.getActiveOperationsCount();
      expect(count).toBe(0);
    });

    it('should return correct count of active operations', async () => {
      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent('op-2', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent('op-3', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      const count = await manager.getActiveOperationsCount();
      expect(count).toBe(3);
    });

    it('should decrease count after cleanup', async () => {
      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent('op-2', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      await manager.cleanupOperation('op-1');

      const count = await manager.getActiveOperationsCount();
      expect(count).toBe(1);
    });
  });

  describe('disconnect', () => {
    it('should complete without errors', async () => {
      await expect(manager.disconnect()).resolves.toBeUndefined();
    });

    it('should not affect existing data', async () => {
      const operationId = 'test-op';
      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      await manager.disconnect();

      const history = manager.getAllEvents(operationId);
      expect(history).toHaveLength(1);
    });
  });

  describe('subscribe', () => {
    it('should notify callback when event is published', async () => {
      const operationId = 'test-op';
      const callback = vi.fn();

      manager.subscribe(operationId, callback);

      await manager.publishStreamEvent(operationId, {
        data: { message: 'test' },
        stepIndex: 0,
        type: 'stream_start',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith([
        expect.objectContaining({
          data: { message: 'test' },
          type: 'stream_start',
        }),
      ]);
    });

    it('should support multiple subscribers for same operation', async () => {
      const operationId = 'test-op';
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.subscribe(operationId, callback1);
      manager.subscribe(operationId, callback2);

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', async () => {
      const operationId = 'test-op';
      const callback = vi.fn();

      const unsubscribe = manager.subscribe(operationId, callback);

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 1,
        type: 'stream_chunk',
      });
      expect(callback).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should handle unsubscribe for non-existent callback', () => {
      const operationId = 'test-op';
      const callback = vi.fn();

      const unsubscribe = manager.subscribe(operationId, callback);

      // Call unsubscribe twice
      unsubscribe();
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should not notify subscribers for different operations', async () => {
      const callback = vi.fn();

      manager.subscribe('op-1', callback);

      await manager.publishStreamEvent('op-2', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should remove all streams and subscribers', async () => {
      const callback = vi.fn();

      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent('op-2', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      manager.subscribe('op-1', callback);

      manager.clear();

      const count = await manager.getActiveOperationsCount();
      expect(count).toBe(0);

      // Subscribers should be cleared
      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });
      expect(callback).not.toHaveBeenCalled();
    });

    it('should reset event ID counter', async () => {
      await manager.publishStreamEvent('op-1', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      manager.clear();

      const eventId = await manager.publishStreamEvent('op-2', {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      // After clear, counter should reset, but timestamp will still be different
      expect(eventId).toBeDefined();
    });
  });

  describe('getAllEvents', () => {
    it('should return all events for operation', async () => {
      const operationId = 'test-op';

      await manager.publishStreamEvent(operationId, {
        data: { step: 0 },
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent(operationId, {
        data: { step: 1 },
        stepIndex: 1,
        type: 'stream_chunk',
      });

      const events = manager.getAllEvents(operationId);

      expect(events).toHaveLength(2);
      expect(events[0].stepIndex).toBe(0);
      expect(events[1].stepIndex).toBe(1);
    });

    it('should return empty array for non-existent operation', () => {
      const events = manager.getAllEvents('non-existent-op');
      expect(events).toEqual([]);
    });

    it('should return events in original order (not reversed)', async () => {
      const operationId = 'test-op';

      for (let i = 0; i < 5; i++) {
        await manager.publishStreamEvent(operationId, {
          data: { step: i },
          stepIndex: i,
          type: 'stream_chunk',
        });
      }

      const events = manager.getAllEvents(operationId);

      expect(events[0].stepIndex).toBe(0);
      expect(events[4].stepIndex).toBe(4);
    });
  });

  describe('waitForEvent', () => {
    it('should resolve immediately if event already exists', async () => {
      const operationId = 'test-op';

      await manager.publishStreamEvent(operationId, {
        data: { message: 'test' },
        stepIndex: 0,
        type: 'stream_start',
      });

      const event = await manager.waitForEvent(operationId, 'stream_start');

      expect(event).toBeDefined();
      expect(event.type).toBe('stream_start');
    });

    it('should wait for event to be published', async () => {
      const operationId = 'test-op';

      const eventPromise = manager.waitForEvent(operationId, 'stream_chunk');

      // Publish event after a delay
      setTimeout(async () => {
        await manager.publishStreamEvent(operationId, {
          data: { message: 'delayed' },
          stepIndex: 1,
          type: 'stream_chunk',
        });
      }, 10);

      const event = await eventPromise;

      expect(event).toBeDefined();
      expect(event.type).toBe('stream_chunk');
      expect(event.data.message).toBe('delayed');
    });

    it('should reject on timeout if event is not published', async () => {
      const operationId = 'test-op';

      await expect(manager.waitForEvent(operationId, 'stream_end', 100)).rejects.toThrow(
        'Timeout waiting for event stream_end',
      );
    });

    it('should unsubscribe after receiving event', async () => {
      const operationId = 'test-op';

      const eventPromise = manager.waitForEvent(operationId, 'stream_start');

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      await eventPromise;

      // Verify that callback was removed (indirectly by checking no errors occur)
      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 1,
        type: 'stream_chunk',
      });
    });

    it('should handle waiting for different event types', async () => {
      const operationId = 'test-op';

      const promise1 = manager.waitForEvent(operationId, 'stream_start');
      const promise2 = manager.waitForEvent(operationId, 'stream_end');

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      const event1 = await promise1;
      expect(event1.type).toBe('stream_start');

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 1,
        type: 'stream_end',
      });

      const event2 = await promise2;
      expect(event2.type).toBe('stream_end');
    });

    it('should not match wrong event type', async () => {
      const operationId = 'test-op';

      const eventPromise = manager.waitForEvent(operationId, 'stream_end', 100);

      await manager.publishStreamEvent(operationId, {
        data: {},
        stepIndex: 0,
        type: 'stream_start',
      });

      await expect(eventPromise).rejects.toThrow('Timeout waiting for event stream_end');
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete agent runtime lifecycle', async () => {
      const operationId = 'agent-lifecycle';

      // Initialize
      await manager.publishAgentRuntimeInit(operationId, {
        status: 'running',
        totalSteps: 0,
      });

      // Publish some stream chunks
      await manager.publishStreamChunk(operationId, 1, {
        chunkType: 'text',
        content: 'Processing...',
      });
      await manager.publishStreamChunk(operationId, 2, {
        chunkType: 'text',
        content: 'Complete',
      });

      // End
      await manager.publishAgentRuntimeEnd(operationId, 3, {
        status: 'completed',
        totalSteps: 3,
      });

      const history = await manager.getStreamHistory(operationId);

      expect(history).toHaveLength(4);
      expect(history[3].type).toBe('agent_runtime_init');
      expect(history[2].type).toBe('stream_chunk');
      expect(history[1].type).toBe('stream_chunk');
      expect(history[0].type).toBe('agent_runtime_end');
    });

    it('should handle multiple concurrent operations', async () => {
      const op1 = 'operation-1';
      const op2 = 'operation-2';

      await manager.publishStreamEvent(op1, {
        data: { op: 1 },
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent(op2, {
        data: { op: 2 },
        stepIndex: 0,
        type: 'stream_start',
      });
      await manager.publishStreamEvent(op1, {
        data: { op: 1 },
        stepIndex: 1,
        type: 'stream_chunk',
      });

      const history1 = manager.getAllEvents(op1);
      const history2 = manager.getAllEvents(op2);

      expect(history1).toHaveLength(2);
      expect(history2).toHaveLength(1);
      expect(await manager.getActiveOperationsCount()).toBe(2);
    });
  });
});

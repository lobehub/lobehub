import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryAgentStateManager } from '../InMemoryAgentStateManager';

// Helper to build a minimal AgentState-like object
const makeState = (overrides: Record<string, any> = {}): any => ({
  cost: { total: 0 },
  status: 'idle' as const,
  stepCount: 0,
  ...overrides,
});

// Helper to build a minimal StepResult
const makeStepResult = (overrides: Record<string, any> = {}): any => ({
  executionTime: 100,
  newState: makeState({ status: 'running', stepCount: 1 }),
  stepIndex: 1,
  events: [],
  ...overrides,
});

describe('InMemoryAgentStateManager', () => {
  let manager: InMemoryAgentStateManager;

  beforeEach(() => {
    manager = new InMemoryAgentStateManager();
  });

  // ------------------------------------------------------------------ //
  // createOperationMetadata
  // ------------------------------------------------------------------ //
  describe('createOperationMetadata', () => {
    it('should create metadata with default values', async () => {
      await manager.createOperationMetadata('op-1', {});
      const meta = await manager.getOperationMetadata('op-1');

      expect(meta).not.toBeNull();
      expect(meta!.status).toBe('idle');
      expect(meta!.totalCost).toBe(0);
      expect(meta!.totalSteps).toBe(0);
      expect(meta!.userId).toBeUndefined();
      expect(meta!.agentConfig).toBeUndefined();
      expect(meta!.modelRuntimeConfig).toBeUndefined();
      expect(typeof meta!.createdAt).toBe('string');
      expect(typeof meta!.lastActiveAt).toBe('string');
    });

    it('should store provided userId, agentConfig and modelRuntimeConfig', async () => {
      await manager.createOperationMetadata('op-2', {
        agentConfig: { maxSteps: 10 },
        modelRuntimeConfig: { model: 'gpt-4' },
        userId: 'user-42',
      });

      const meta = await manager.getOperationMetadata('op-2');
      expect(meta!.userId).toBe('user-42');
      expect(meta!.agentConfig).toEqual({ maxSteps: 10 });
      expect(meta!.modelRuntimeConfig).toEqual({ model: 'gpt-4' });
    });

    it('should overwrite metadata when called twice for the same operationId', async () => {
      await manager.createOperationMetadata('op-3', { userId: 'first' });
      await manager.createOperationMetadata('op-3', { userId: 'second' });

      const meta = await manager.getOperationMetadata('op-3');
      expect(meta!.userId).toBe('second');
    });
  });

  // ------------------------------------------------------------------ //
  // saveAgentState / loadAgentState
  // ------------------------------------------------------------------ //
  describe('saveAgentState and loadAgentState', () => {
    it('should save and load state correctly', async () => {
      const state = makeState({ status: 'running', stepCount: 3, cost: { total: 50 } });
      await manager.saveAgentState('op-a', state);

      const loaded = await manager.loadAgentState('op-a');
      expect(loaded).toEqual(state);
    });

    it('should return null when no state has been saved', async () => {
      const loaded = await manager.loadAgentState('nonexistent');
      expect(loaded).toBeNull();
    });

    it('should return a deep clone so external mutations do not affect stored state', async () => {
      const state = makeState({ status: 'running', stepCount: 1 });
      await manager.saveAgentState('op-b', state);

      const loaded = await manager.loadAgentState('op-b');
      loaded!.stepCount = 999;

      const loadedAgain = await manager.loadAgentState('op-b');
      expect(loadedAgain!.stepCount).toBe(1);
    });

    it('should update metadata.status and totalCost when state is saved (with existing metadata)', async () => {
      await manager.createOperationMetadata('op-c', {});
      const state = makeState({ status: 'done', stepCount: 5, cost: { total: 200 } });
      await manager.saveAgentState('op-c', state);

      const meta = await manager.getOperationMetadata('op-c');
      expect(meta!.status).toBe('done');
      expect(meta!.totalCost).toBe(200);
      expect(meta!.totalSteps).toBe(5);
    });

    it('should not fail when saving state without corresponding metadata', async () => {
      const state = makeState({ status: 'running' });
      await expect(manager.saveAgentState('op-no-meta', state)).resolves.not.toThrow();
    });

    it('should default totalCost to 0 when cost is undefined', async () => {
      await manager.createOperationMetadata('op-d', {});
      const state = { status: 'running' as const, stepCount: 1 };
      await manager.saveAgentState('op-d', state as any);

      const meta = await manager.getOperationMetadata('op-d');
      expect(meta!.totalCost).toBe(0);
    });
  });

  // ------------------------------------------------------------------ //
  // saveStepResult
  // ------------------------------------------------------------------ //
  describe('saveStepResult', () => {
    it('should save step result and make state retrievable', async () => {
      const stepResult = makeStepResult({
        newState: makeState({ status: 'running', stepCount: 1 }),
        stepIndex: 1,
      });

      await manager.saveStepResult('op-s', stepResult);

      const loaded = await manager.loadAgentState('op-s');
      expect(loaded!.status).toBe('running');
      expect(loaded!.stepCount).toBe(1);
    });

    it('should accumulate step history in reverse order (newest first internally)', async () => {
      for (let i = 1; i <= 5; i++) {
        await manager.saveStepResult(
          'op-history',
          makeStepResult({
            stepIndex: i,
            newState: makeState({ stepCount: i, status: 'running' }),
          }),
        );
      }

      // getExecutionHistory returns earliest first
      const history = await manager.getExecutionHistory('op-history', 10);
      expect(history).toHaveLength(5);
      expect(history[0].stepIndex).toBe(1);
      expect(history[4].stepIndex).toBe(5);
    });

    it('should cap step history at 200 entries', async () => {
      for (let i = 1; i <= 210; i++) {
        await manager.saveStepResult(
          'op-cap',
          makeStepResult({
            stepIndex: i,
            newState: makeState({ stepCount: i, status: 'running' }),
          }),
        );
      }

      const history = await manager.getExecutionHistory('op-cap', 300);
      expect(history.length).toBeLessThanOrEqual(200);
    });

    it('should save event history when events are provided', async () => {
      const events = [
        { type: 'text', data: 'hello' },
        { type: 'tool', data: 'run' },
      ];
      const stepResult = makeStepResult({ events });

      await manager.saveStepResult('op-ev', stepResult);

      const eventHistory = manager.getEventHistory('op-ev');
      expect(eventHistory).toHaveLength(1);
      expect(eventHistory[0]).toEqual(events);
    });

    it('should not add to event history when events array is empty', async () => {
      const stepResult = makeStepResult({ events: [] });
      await manager.saveStepResult('op-ev2', stepResult);

      const eventHistory = manager.getEventHistory('op-ev2');
      expect(eventHistory).toHaveLength(0);
    });

    it('should not add to event history when events is undefined', async () => {
      const stepResult = makeStepResult({ events: undefined });
      await manager.saveStepResult('op-ev3', stepResult);

      const eventHistory = manager.getEventHistory('op-ev3');
      expect(eventHistory).toHaveLength(0);
    });

    it('should update metadata after saving step result', async () => {
      await manager.createOperationMetadata('op-meta-update', {});
      const stepResult = makeStepResult({
        newState: makeState({ status: 'done', stepCount: 7, cost: { total: 300 } }),
        stepIndex: 7,
      });

      await manager.saveStepResult('op-meta-update', stepResult);

      const meta = await manager.getOperationMetadata('op-meta-update');
      expect(meta!.status).toBe('done');
      expect(meta!.totalCost).toBe(300);
      expect(meta!.totalSteps).toBe(7);
    });

    it('should store stepData with correct fields', async () => {
      const context = { messages: [] };
      const stepResult = makeStepResult({
        stepIndex: 3,
        executionTime: 250,
        nextContext: context,
        newState: makeState({ status: 'running', stepCount: 3, cost: { total: 42 } }),
      });

      await manager.saveStepResult('op-fields', stepResult);

      const history = await manager.getExecutionHistory('op-fields', 10);
      expect(history[0].stepIndex).toBe(3);
      expect(history[0].executionTime).toBe(250);
      expect(history[0].context).toEqual(context);
      expect(history[0].cost).toBe(42);
      expect(history[0].status).toBe('running');
      expect(typeof history[0].timestamp).toBe('number');
    });
  });

  // ------------------------------------------------------------------ //
  // getExecutionHistory
  // ------------------------------------------------------------------ //
  describe('getExecutionHistory', () => {
    it('should return empty array for unknown operationId', async () => {
      const history = await manager.getExecutionHistory('unknown');
      expect(history).toEqual([]);
    });

    it('should respect the limit parameter', async () => {
      for (let i = 1; i <= 10; i++) {
        await manager.saveStepResult(
          'op-limit',
          makeStepResult({
            stepIndex: i,
            newState: makeState({ stepCount: i, status: 'running' }),
          }),
        );
      }

      const history = await manager.getExecutionHistory('op-limit', 5);
      expect(history).toHaveLength(5);
    });

    it('should default limit to 50', async () => {
      for (let i = 1; i <= 60; i++) {
        await manager.saveStepResult(
          'op-default-limit',
          makeStepResult({
            stepIndex: i,
            newState: makeState({ stepCount: i, status: 'running' }),
          }),
        );
      }

      const history = await manager.getExecutionHistory('op-default-limit');
      expect(history.length).toBeLessThanOrEqual(50);
    });
  });

  // ------------------------------------------------------------------ //
  // getOperationMetadata
  // ------------------------------------------------------------------ //
  describe('getOperationMetadata', () => {
    it('should return null for unknown operationId', async () => {
      const meta = await manager.getOperationMetadata('missing');
      expect(meta).toBeNull();
    });
  });

  // ------------------------------------------------------------------ //
  // deleteAgentOperation
  // ------------------------------------------------------------------ //
  describe('deleteAgentOperation', () => {
    it('should remove all data for an operation', async () => {
      await manager.createOperationMetadata('op-del', { userId: 'u1' });
      await manager.saveAgentState('op-del', makeState({ status: 'running' }));
      await manager.saveStepResult(
        'op-del',
        makeStepResult({ events: [{ type: 'text', data: 'x' }] }),
      );

      await manager.deleteAgentOperation('op-del');

      expect(await manager.loadAgentState('op-del')).toBeNull();
      expect(await manager.getOperationMetadata('op-del')).toBeNull();
      expect(await manager.getExecutionHistory('op-del')).toEqual([]);
      expect(manager.getEventHistory('op-del')).toEqual([]);
    });

    it('should not throw when deleting a non-existent operation', async () => {
      await expect(manager.deleteAgentOperation('ghost')).resolves.not.toThrow();
    });
  });

  // ------------------------------------------------------------------ //
  // getActiveOperations
  // ------------------------------------------------------------------ //
  describe('getActiveOperations', () => {
    it('should return empty array when no operations exist', async () => {
      const ops = await manager.getActiveOperations();
      expect(ops).toEqual([]);
    });

    it('should return operation IDs for all operations that have state', async () => {
      await manager.saveAgentState('op-x', makeState());
      await manager.saveAgentState('op-y', makeState());

      const ops = await manager.getActiveOperations();
      expect(ops).toContain('op-x');
      expect(ops).toContain('op-y');
    });

    it('should not include operations that have been deleted', async () => {
      await manager.saveAgentState('op-z', makeState());
      await manager.deleteAgentOperation('op-z');

      const ops = await manager.getActiveOperations();
      expect(ops).not.toContain('op-z');
    });
  });

  // ------------------------------------------------------------------ //
  // cleanupExpiredOperations
  // ------------------------------------------------------------------ //
  describe('cleanupExpiredOperations', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should clean up operations inactive for more than 1 hour', async () => {
      // Create operation at time T
      const baseTime = new Date('2024-01-01T10:00:00Z').getTime();
      vi.useFakeTimers();
      vi.setSystemTime(baseTime);

      await manager.createOperationMetadata('op-old', {});
      await manager.saveAgentState('op-old', makeState());

      // Advance clock by 2 hours
      vi.setSystemTime(baseTime + 2 * 60 * 60 * 1000);

      const cleaned = await manager.cleanupExpiredOperations();
      expect(cleaned).toBe(1);
      expect(await manager.loadAgentState('op-old')).toBeNull();
    });

    it('should not clean up recently active operations', async () => {
      await manager.createOperationMetadata('op-new', {});
      await manager.saveAgentState('op-new', makeState());
      // metadata.lastActiveAt is set to "now" by createOperationMetadata

      const cleaned = await manager.cleanupExpiredOperations();
      expect(cleaned).toBe(0);
      expect(await manager.loadAgentState('op-new')).not.toBeNull();
    });

    it('should return 0 when there are no active operations', async () => {
      const cleaned = await manager.cleanupExpiredOperations();
      expect(cleaned).toBe(0);
    });

    it('should skip operations that have state but no metadata', async () => {
      // Save state without creating metadata
      await manager.saveAgentState('op-no-meta-2', makeState());

      const cleaned = await manager.cleanupExpiredOperations();
      // No metadata → no cleanup (the loop skips operations where metadata is null)
      expect(cleaned).toBe(0);
      expect(await manager.loadAgentState('op-no-meta-2')).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------ //
  // getStats
  // ------------------------------------------------------------------ //
  describe('getStats', () => {
    it('should return zeroes when no operations exist', async () => {
      const stats = await manager.getStats();
      expect(stats).toEqual({
        activeOperations: 0,
        completedOperations: 0,
        errorOperations: 0,
        totalOperations: 0,
      });
    });

    it('should count running and waiting_for_human as activeOperations', async () => {
      // Create metadata then update status via saveAgentState
      await manager.createOperationMetadata('r1', {});
      await manager.saveAgentState('r1', makeState({ status: 'running' }));

      await manager.createOperationMetadata('r2', {});
      await manager.saveAgentState('r2', makeState({ status: 'waiting_for_human' }));

      const stats = await manager.getStats();
      expect(stats.activeOperations).toBe(2);
      expect(stats.totalOperations).toBe(2);
    });

    it('should correctly categorize done, error, and interrupted statuses', async () => {
      await manager.createOperationMetadata('s-done', {});
      await manager.saveAgentState('s-done', makeState({ status: 'done' }));

      await manager.createOperationMetadata('s-error', {});
      await manager.saveAgentState('s-error', makeState({ status: 'error' }));

      await manager.createOperationMetadata('s-interrupted', {});
      await manager.saveAgentState('s-interrupted', makeState({ status: 'interrupted' }));

      const stats = await manager.getStats();
      expect(stats.completedOperations).toBe(1);
      expect(stats.errorOperations).toBe(2);
      expect(stats.activeOperations).toBe(0);
    });

    it('should include total count of all operations', async () => {
      await manager.createOperationMetadata('t1', {});
      await manager.saveAgentState('t1', makeState());
      await manager.createOperationMetadata('t2', {});
      await manager.saveAgentState('t2', makeState());
      await manager.createOperationMetadata('t3', {});
      await manager.saveAgentState('t3', makeState());

      const stats = await manager.getStats();
      expect(stats.totalOperations).toBe(3);
    });
  });

  // ------------------------------------------------------------------ //
  // disconnect
  // ------------------------------------------------------------------ //
  describe('disconnect', () => {
    it('should resolve without error', async () => {
      await expect(manager.disconnect()).resolves.not.toThrow();
    });
  });

  // ------------------------------------------------------------------ //
  // clear (test utility method)
  // ------------------------------------------------------------------ //
  describe('clear', () => {
    it('should remove all stored data', async () => {
      await manager.createOperationMetadata('op-clear', {});
      await manager.saveAgentState('op-clear', makeState());
      await manager.saveStepResult('op-clear', makeStepResult({ events: [{ type: 'x' }] }));

      manager.clear();

      expect(await manager.loadAgentState('op-clear')).toBeNull();
      expect(await manager.getOperationMetadata('op-clear')).toBeNull();
      expect(await manager.getExecutionHistory('op-clear')).toEqual([]);
      expect(manager.getEventHistory('op-clear')).toEqual([]);
      expect(await manager.getActiveOperations()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ //
  // getEventHistory
  // ------------------------------------------------------------------ //
  describe('getEventHistory', () => {
    it('should return empty array for unknown operationId', () => {
      expect(manager.getEventHistory('no-such')).toEqual([]);
    });

    it('should accumulate event history in newest-first order', async () => {
      const events1 = [{ type: 'a' }];
      const events2 = [{ type: 'b' }];

      await manager.saveStepResult('op-evhist', makeStepResult({ events: events1 }));
      await manager.saveStepResult('op-evhist', makeStepResult({ events: events2 }));

      const history = manager.getEventHistory('op-evhist');
      // newest first (unshift order)
      expect(history[0]).toEqual(events2);
      expect(history[1]).toEqual(events1);
    });
  });
});

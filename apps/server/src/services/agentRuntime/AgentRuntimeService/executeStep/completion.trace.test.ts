import type { ExecutionSnapshot, ISnapshotStore } from '@lobechat/agent-tracing';
import { describe, expect, it, vi } from 'vitest';

import { type AppendStepParams, OperationTraceRecorder } from '../../OperationTraceRecorder';
import { finishOperation, type StepCompletionDeps } from './completion';

const operationId = 'op_parked';

const stepParams = (stepIndex: number): AppendStepParams => ({
  afterStepSignalEvents: [],
  agentState: { messages: [] },
  beforeStepSignalEvents: [],
  externalRetryCount: 0,
  presentation: {
    executionTimeMs: 1,
    stepType: 'call_tool',
    thinking: false,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalSteps: stepIndex + 1,
    totalTokens: 0,
  },
  startedAt: 0,
  stepIndex,
  stepResult: { events: [], newState: { messages: [] } },
});

describe('parked operation trace handoff', () => {
  it('persists a readable wait before resuming and never overwrites the resumed trajectory', async () => {
    let partial: Partial<ExecutionSnapshot> | null = null;
    let snapshot: ExecutionSnapshot | null = null;
    const store = {
      get: async () => structuredClone(snapshot),
      getLatest: async () => structuredClone(snapshot),
      list: async () => [],
      listPartials: async () => [],
      loadPartial: async () => structuredClone(partial),
      removePartial: async () => {
        partial = null;
      },
      save: async (value: ExecutionSnapshot) => {
        snapshot = structuredClone(value);
      },
      savePartial: async (_id: string, value: Partial<ExecutionSnapshot>) => {
        partial = structuredClone(value);
      },
    } satisfies ISnapshotStore;

    const recorder = new OperationTraceRecorder(store);
    await recorder.appendStep(operationId, stepParams(0));
    await recorder.appendStep(operationId, stepParams(1));
    // The resumed invocation runs immediately when the park-time barrier opens.
    let atHandoff: ExecutionSnapshot | null = null;
    let partialAtHandoff: Partial<ExecutionSnapshot> | null = null;
    const tryResumeParentFromAsyncTool = vi.fn(async () => {
      atHandoff = await store.get();
      partialAtHandoff = await store.loadPartial();
      const resumed = new OperationTraceRecorder(store);
      await resumed.appendStep(operationId, stepParams(2));
      await resumed.appendStep(operationId, stepParams(3));
      await resumed.finalize(operationId, { completionReason: 'done', state: {} });
    });
    const deps = {
      completionLifecycle: {
        dispatchHooks: vi.fn(),
        emitSignalEvents: vi.fn().mockResolvedValue([{ type: 'signal' }]),
      },
      delegate: {},
      determineCompletionReason: () => 'waiting_for_async_tool',
      traceRecorder: recorder,
      tryResumeParentFromAsyncTool,
      userId: 'user_1',
    } as unknown as StepCompletionDeps;

    await finishOperation(deps, {
      invokeAgentSpan: { setAttributes: vi.fn() } as unknown as Parameters<
        typeof finishOperation
      >[1]['invokeAgentSpan'],
      operationId,
      stepIndex: 1,
      stepResult: {
        newState: { status: 'waiting_for_async_tool' },
      } as Parameters<typeof finishOperation>[1]['stepResult'],
    });

    expect(tryResumeParentFromAsyncTool).toHaveBeenCalledOnce();
    expect(atHandoff).toMatchObject({
      completionReason: 'waiting_for_async_tool',
      steps: [{ stepIndex: 0 }, { stepIndex: 1 }],
      totalSteps: 2,
    });
    expect(partialAtHandoff).toMatchObject({ steps: [{ stepIndex: 0 }, { stepIndex: 1 }] });
    expect(await store.get()).toMatchObject({
      completionReason: 'done',
      steps: [{ stepIndex: 0 }, { stepIndex: 1 }, { stepIndex: 2 }, { stepIndex: 3 }],
      totalSteps: 4,
    });
    expect(await store.loadPartial()).toBeNull();
  });
});

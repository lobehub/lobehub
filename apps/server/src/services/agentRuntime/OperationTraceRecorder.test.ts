import type { ExecutionSnapshot, ISnapshotStore } from '@lobechat/agent-tracing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppendStepParams, OperationTraceRecorder } from './OperationTraceRecorder';

const OPERATION_ID = 'op_1';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const stepParams = (stepIndex: number): AppendStepParams => ({
  afterStepSignalEvents: [],
  agentState: { messages: [] },
  beforeStepSignalEvents: [],
  externalRetryCount: 0,
  presentation: { executionTimeMs: 1, stepType: 'call_llm', thinking: false } as any,
  startedAt: 0,
  stepIndex,
  stepResult: { events: [], newState: { messages: [] } },
});

const createStore = () => {
  const store = {
    loadPartial: vi.fn<(operationId: string) => Promise<Partial<ExecutionSnapshot> | null>>(
      async () => null,
    ),
    removePartial: vi.fn<(operationId: string) => Promise<void>>(async () => {}),
    save: vi.fn<(snapshot: ExecutionSnapshot) => Promise<void>>(async () => {}),
    savePartial: vi.fn<
      (
        operationId: string,
        partial: Partial<ExecutionSnapshot>,
        options?: { signal?: AbortSignal },
      ) => Promise<void>
    >(async () => {}),
  };
  return store as typeof store & ISnapshotStore;
};

describe('OperationTraceRecorder partial accumulation', () => {
  let store: ReturnType<typeof createStore>;
  let recorder: OperationTraceRecorder;

  beforeEach(() => {
    store = createStore();
    recorder = new OperationTraceRecorder(store);
  });

  it('reads the stored partial once for a run of steps', async () => {
    await recorder.appendStep(OPERATION_ID, stepParams(0));
    await recorder.appendStep(OPERATION_ID, stepParams(1));
    await recorder.appendStep(OPERATION_ID, stepParams(2));
    await recorder.flushPartial();

    expect(store.loadPartial).toHaveBeenCalledTimes(1);
    expect(store.savePartial.mock.calls.at(-1)?.[1].steps).toHaveLength(3);
  });

  it('returns from the step without waiting for the upload', async () => {
    const upload = deferred();
    let uploaded = false;
    store.savePartial.mockImplementation(async () => {
      await upload.promise;
      uploaded = true;
    });

    await recorder.appendStep(OPERATION_ID, stepParams(0));
    expect(uploaded).toBe(false);

    upload.resolve();
    await recorder.flushPartial();
    expect(uploaded).toBe(true);
  });

  it('collapses steps appended during an upload into a single follow-up upload', async () => {
    const first = deferred();
    store.savePartial.mockImplementationOnce(async () => {
      await first.promise;
    });

    await recorder.appendStep(OPERATION_ID, stepParams(0));
    await recorder.appendStep(OPERATION_ID, stepParams(1));
    await recorder.appendStep(OPERATION_ID, stepParams(2));

    first.resolve();
    await recorder.flushPartial();

    // One upload for step 0, one for the three that landed while it ran.
    expect(store.savePartial).toHaveBeenCalledTimes(2);
    expect(store.savePartial.mock.calls.at(-1)?.[1].steps).toHaveLength(3);
  });

  it('finalizes from memory and deletes the partial after the final snapshot', async () => {
    await recorder.appendStep(OPERATION_ID, stepParams(0));
    await recorder.finalize(OPERATION_ID, { completionReason: 'done', state: {} });

    expect(store.loadPartial).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save.mock.calls[0][0].steps).toHaveLength(1);
    expect(store.removePartial).toHaveBeenCalledTimes(1);
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(
      store.removePartial.mock.invocationCallOrder[0],
    );
  });

  it('does not upload steps after the operation lock is lost', async () => {
    const first = deferred();
    store.savePartial.mockImplementationOnce(async () => {
      await first.promise;
    });

    await recorder.appendStep(OPERATION_ID, stepParams(0));
    await recorder.appendStep(OPERATION_ID, stepParams(1));
    recorder.discardPartial();

    first.resolve();
    await recorder.flushPartial();

    expect(store.savePartial).toHaveBeenCalledTimes(1);
  });

  it('aborts the upload in flight when the operation is handed over', async () => {
    const upload = deferred();
    let seenSignal: AbortSignal | undefined;
    store.savePartial.mockImplementation(async (_id, _partial, options) => {
      seenSignal = options?.signal;
      await upload.promise;
    });

    await recorder.appendStep(OPERATION_ID, stepParams(0));
    expect(seenSignal?.aborted).toBe(false);

    recorder.discardPartial();

    // The upload already on the wire is cancelled, so it cannot land on top of
    // the partial the new owner is writing.
    expect(seenSignal?.aborted).toBe(true);

    upload.resolve();
    await recorder.flushPartial();
    expect(store.savePartial).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without a store', async () => {
    const disabled = new OperationTraceRecorder(null);
    await disabled.appendStep(OPERATION_ID, stepParams(0));
    await expect(disabled.flushPartial()).resolves.toBeUndefined();
  });
});

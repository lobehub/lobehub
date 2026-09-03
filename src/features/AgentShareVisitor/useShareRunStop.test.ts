import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Operation } from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const mocks = vi.hoisted(() => ({
  interruptTask: vi.fn(),
}));

vi.mock('@/services/shareChat', () => ({
  shareChatService: { interruptTask: mocks.interruptTask },
}));

const updateOperationMetadata = vi.fn();
let operations: Operation[] = [];

const contextKey = messageMapKey({ agentId: 'agent-1', scope: 'main', topicId: 'topic-1' });

// A tiny fake chat store, same shape used by `useVisitorConversationSeed.test.ts`:
// only the bits `useShareRunStop` actually touches (`operationsByContext` /
// `operations` for the real `getOperationsByContext` selector, plus
// `updateOperationMetadata`).
vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({
      operations: Object.fromEntries(operations.map((op) => [op.id, op])),
      operationsByContext: { [contextKey]: operations.map((op) => op.id) },
      updateOperationMetadata,
    }),
  },
}));

const { resolveRunningShareOperation, useShareRunStop } = await import('./useShareRunStop');

const runningOp = (overrides: Partial<Operation> = {}): Operation =>
  ({
    abortController: new AbortController(),
    context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
    id: 'local-op-1',
    metadata: { serverOperationId: 'server-op-1', startTime: Date.now() },
    status: 'running',
    type: 'execServerAgentRuntime',
    ...overrides,
  }) as Operation;

describe('resolveRunningShareOperation', () => {
  it('returns undefined when nothing is running', () => {
    expect(resolveRunningShareOperation([])).toBeUndefined();
  });

  it('ignores operations that are not AI-runtime types', () => {
    const op = runningOp({ type: 'sendMessage' as Operation['type'] });
    expect(resolveRunningShareOperation([op])).toBeUndefined();
  });

  it('ignores operations missing a server-side operation id', () => {
    const op = runningOp({ metadata: { startTime: Date.now() } });
    expect(resolveRunningShareOperation([op])).toBeUndefined();
  });

  it('picks the running execServerAgentRuntime operation', () => {
    const op = runningOp();
    expect(resolveRunningShareOperation([op])).toEqual({
      localOperationId: 'local-op-1',
      serverOperationId: 'server-op-1',
      topicId: 'topic-1',
    });
  });
});

describe('useShareRunStop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operations = [];
  });

  it('is a no-op when nothing is running for the context', async () => {
    const { result } = renderHook(() => useShareRunStop('share-1', 'agent-1', 'topic-1'));

    await act(async () => {
      await result.current.stopSharedRun();
    });

    expect(mocks.interruptTask).not.toHaveBeenCalled();
    expect(updateOperationMetadata).not.toHaveBeenCalled();
  });

  it('flips isAborting immediately and calls shareChat.interruptTask for the running op', async () => {
    operations = [runningOp()];
    mocks.interruptTask.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useShareRunStop('share-1', 'agent-1', 'topic-1'));

    await act(async () => {
      await result.current.stopSharedRun();
    });

    expect(updateOperationMetadata).toHaveBeenCalledWith('local-op-1', { isAborting: true });
    expect(mocks.interruptTask).toHaveBeenCalledWith('share-1', 'topic-1', 'server-op-1');
    expect(result.current.stopping).toBe(false);
    expect(result.current.stopError).toBeUndefined();
  });

  it('surfaces an interrupt failure and restores the loading indicator instead of swallowing it', async () => {
    operations = [runningOp()];
    mocks.interruptTask.mockRejectedValueOnce(new Error('already finished'));
    const { result } = renderHook(() => useShareRunStop('share-1', 'agent-1', 'topic-1'));

    await act(async () => {
      await result.current.stopSharedRun();
    });

    await waitFor(() => {
      expect(result.current.stopError).toBeInstanceOf(Error);
    });
    // Restored to `false` — the interrupt didn't land, so the run is presumably
    // still going and the busy indicator should not stay stuck off.
    expect(updateOperationMetadata).toHaveBeenLastCalledWith('local-op-1', {
      isAborting: false,
    });
    expect(result.current.stopping).toBe(false);
  });

  it('ignores a concurrent stop while one is already in flight', async () => {
    operations = [runningOp()];
    let resolveFirst: ((value: { success: boolean }) => void) | undefined;
    mocks.interruptTask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useShareRunStop('share-1', 'agent-1', 'topic-1'));

    let firstCall!: Promise<void>;
    act(() => {
      firstCall = result.current.stopSharedRun();
    });
    expect(result.current.stopping).toBe(true);

    await act(async () => {
      await result.current.stopSharedRun();
    });
    expect(mocks.interruptTask).toHaveBeenCalledTimes(1);

    resolveFirst?.({ success: true });
    await act(async () => {
      await firstCall;
    });
  });
});

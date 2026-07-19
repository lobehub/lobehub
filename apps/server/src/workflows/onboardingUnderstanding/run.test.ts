// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { UnderstandingService } from '@/server/services/understanding/service';

import { runOnboardingUnderstandingWorkflow } from './run';

vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createContext = (payload: unknown, steps: string[] = []) => ({
  requestPayload: payload,
  run: async <T>(step: string, handler: () => Promise<T>) => {
    steps.push(step);
    return handler();
  },
  workflowRunId: 'workflow-1',
});

const createService = () => {
  const service = {
    attachWorkflowRun: vi.fn().mockResolvedValue(undefined),
    collectSource: vi.fn().mockResolvedValue({ sourceCount: 1 }),
    discover: vi.fn().mockResolvedValue([
      { sourceId: 'github:account-1', threadId: 'thread-github' },
      { sourceId: 'gmail:account-1', threadId: 'thread-gmail' },
    ]),
    executeAgentOperation: vi.fn().mockResolvedValue({ status: 'done' }),
    failMerge: vi.fn().mockResolvedValue({ kind: 'merge_error', resultId: 'merge-error' }),
    failSource: vi
      .fn()
      .mockImplementation(({ sourceId }) =>
        Promise.resolve({ kind: 'source_error', resultId: `${sourceId}-error` }),
      ),
    finalizeMerge: vi.fn().mockResolvedValue({ kind: 'merged', resultId: 'merge-result' }),
    finalizeSource: vi
      .fn()
      .mockImplementation(({ sourceId }) =>
        Promise.resolve({ kind: 'source', resultId: `${sourceId}-result` }),
      ),
    launchMerge: vi.fn().mockResolvedValue({
      assistantMessageId: 'message-merge',
      operationId: 'operation-merge',
      success: true,
      threadId: 'merge-workflow-1',
    }),
    launchSourceAnalysis: vi.fn().mockImplementation(({ sourceId, threadId }) =>
      Promise.resolve({
        assistantMessageId: `${sourceId}-message`,
        operationId: `${sourceId}-operation`,
        sourceId,
        success: true,
        threadId,
      }),
    ),
    prepareRetry: vi
      .fn()
      .mockResolvedValue({ sourceId: 'gmail:account-1', threadId: 'thread-gmail-retry' }),
  };
  return service as unknown as UnderstandingService & typeof service;
};

const initialPayload = {
  mode: 'initial' as const,
  sessionId: 'session-1',
  topicId: 'topic-1',
  userId: 'user-1',
};

describe('runOnboardingUnderstandingWorkflow', () => {
  it('validates retry source ids', async () => {
    const service = createService();

    await expect(
      runOnboardingUnderstandingWorkflow(createContext({ ...initialPayload, mode: 'retry' }), {
        createService: async () => service,
      }),
    ).rejects.toThrow('sourceId');
    expect(service.attachWorkflowRun).not.toHaveBeenCalled();
  });

  it('collects concurrently, launches serially, then executes concurrently before merging', async () => {
    const service = createService();
    let activeCollections = 0;
    let maxCollections = 0;
    const collectionGate = deferred<void>();
    service.collectSource.mockImplementation(async () => {
      activeCollections += 1;
      maxCollections = Math.max(maxCollections, activeCollections);
      await collectionGate.promise;
      activeCollections -= 1;
      return { sourceCount: 1 };
    });

    const firstLaunch = deferred<ReturnType<typeof launchResult>>();
    const launchResult = (sourceId: string, threadId: string) => ({
      assistantMessageId: `${sourceId}-message`,
      operationId: `${sourceId}-operation`,
      sourceId,
      success: true as const,
      threadId,
    });
    service.launchSourceAnalysis.mockImplementation(({ sourceId, threadId }) =>
      sourceId.startsWith('github')
        ? firstLaunch.promise
        : Promise.resolve(launchResult(sourceId, threadId)),
    );

    let activeExecutions = 0;
    let maxExecutions = 0;
    const executionGate = deferred<void>();
    service.executeAgentOperation.mockImplementation(async () => {
      activeExecutions += 1;
      maxExecutions = Math.max(maxExecutions, activeExecutions);
      await executionGate.promise;
      activeExecutions -= 1;
      return { status: 'done' as const };
    });

    const steps: string[] = [];
    const running = runOnboardingUnderstandingWorkflow(createContext(initialPayload, steps), {
      createService: async () => service,
    });
    await vi.waitFor(() => expect(service.collectSource).toHaveBeenCalledTimes(2));
    expect(maxCollections).toBe(2);
    collectionGate.resolve();

    await vi.waitFor(() => expect(service.launchSourceAnalysis).toHaveBeenCalledTimes(1));
    expect(service.launchSourceAnalysis.mock.calls[0][0].sourceId).toBe('github:account-1');
    expect(service.launchSourceAnalysis).toHaveBeenCalledTimes(1);
    firstLaunch.resolve(launchResult('github:account-1', 'thread-github'));

    await vi.waitFor(() => expect(service.executeAgentOperation).toHaveBeenCalledTimes(2));
    expect(service.launchSourceAnalysis.mock.calls[1][0].sourceId).toBe('gmail:account-1');
    expect(maxExecutions).toBe(2);
    expect(service.launchMerge).not.toHaveBeenCalled();
    executionGate.resolve();

    await expect(running).resolves.toEqual({
      merge: 'completed',
      sources: [
        { sourceId: 'github:account-1', status: 'completed' },
        { sourceId: 'gmail:account-1', status: 'completed' },
      ],
    });
    expect(service.launchMerge).toHaveBeenCalledWith('topic-1', 'session-1', 'merge-workflow-1');
    expect(steps).toEqual([
      'attach-workflow-run',
      'discover',
      'github:collect',
      'gmail:collect',
      'github:launch',
      'gmail:launch',
      'github:execute',
      'gmail:execute',
      'github:finalize',
      'gmail:finalize',
      'merge:launch',
      'merge:execute',
      'merge:finalize',
    ]);
  });

  it('persists a source failure and still merges successful sources', async () => {
    const service = createService();
    service.collectSource.mockImplementation(({ sourceId }) => {
      if (sourceId.startsWith('gmail')) throw new Error('gmail unavailable');
      return Promise.resolve({ sourceCount: 1 });
    });

    await expect(
      runOnboardingUnderstandingWorkflow(createContext(initialPayload), {
        createService: async () => service,
      }),
    ).resolves.toEqual({
      merge: 'completed',
      sources: [
        { sourceId: 'github:account-1', status: 'completed' },
        { sourceId: 'gmail:account-1', status: 'failed' },
      ],
    });
    expect(service.failSource).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceId: 'gmail:account-1',
      threadId: 'thread-gmail',
      topicId: 'topic-1',
    });
    expect(service.launchSourceAnalysis).toHaveBeenCalledTimes(1);
    expect(service.launchMerge).toHaveBeenCalledTimes(1);
  });

  it('prepares only the requested source in retry mode', async () => {
    const service = createService();

    await runOnboardingUnderstandingWorkflow(
      createContext({ ...initialPayload, mode: 'retry', sourceId: 'gmail:account-1' }),
      { createService: async () => service },
    );

    expect(service.discover).not.toHaveBeenCalled();
    expect(service.prepareRetry).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceId: 'gmail:account-1',
      topicId: 'topic-1',
    });
    expect(service.collectSource).toHaveBeenCalledTimes(1);
  });

  it('uses unique stable steps for multiple accounts from one provider', async () => {
    const service = createService();
    service.discover.mockResolvedValue([
      { sourceId: 'github:account-2', threadId: 'thread-2' },
      { sourceId: 'github:account-1', threadId: 'thread-1' },
    ]);
    const steps: string[] = [];

    await runOnboardingUnderstandingWorkflow(createContext(initialPayload, steps), {
      createService: async () => service,
    });

    expect(steps).toContain('github:collect');
    expect(steps).toContain('github-2:collect');
    expect(new Set(steps).size).toBe(steps.length);
  });

  it('fails a merge with the thread returned by its launch', async () => {
    const service = createService();
    service.launchMerge.mockResolvedValue({
      assistantMessageId: 'message-existing',
      operationId: 'operation-existing',
      success: true,
      threadId: 'thread-existing',
    });
    service.executeAgentOperation.mockImplementation((operationId) =>
      operationId === 'operation-existing'
        ? Promise.reject(new Error('execution failed'))
        : Promise.resolve({ status: 'done' }),
    );

    await runOnboardingUnderstandingWorkflow(createContext(initialPayload), {
      createService: async () => service,
    });

    expect(service.failMerge).toHaveBeenCalledWith({
      assistantMessageId: 'message-existing',
      sessionId: 'session-1',
      threadId: 'thread-existing',
      topicId: 'topic-1',
    });
  });
});

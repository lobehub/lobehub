// @vitest-environment node
import {
  StaleUnderstandingSessionError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import { WorkflowAbort } from '@upstash/workflow';
import { describe, expect, it, vi } from 'vitest';

import {
  UnderstandingBranchFailureError,
  type UnderstandingService,
} from '@/server/services/understanding/service';

import {
  createOnboardingUnderstandingWorkflowOptions,
  runOnboardingUnderstandingWorkflow,
} from './run';

const { terminalizeUnderstandingWorkflowMock } = vi.hoisted(() => ({
  terminalizeUnderstandingWorkflowMock: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({
  StaleUnderstandingSessionError: class StaleUnderstandingSessionError extends Error {},
  UnderstandingSessionNotFoundError: class UnderstandingSessionNotFoundError extends Error {},
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
  terminalizeUnderstandingWorkflow: terminalizeUnderstandingWorkflowMock,
  UnderstandingBranchFailureError: class UnderstandingBranchFailureError extends Error {},
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
    getSourceBranches: vi.fn().mockResolvedValue([
      { sourceId: 'github:account-1', threadId: 'thread-github' },
      { sourceId: 'gmail:account-1', threadId: 'thread-gmail' },
    ]),
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
        { index: 0, status: 'completed' },
        { index: 1, status: 'completed' },
      ],
    });
    expect(service.launchMerge).toHaveBeenCalledWith(
      'topic-1',
      'session-1',
      'workflow-1',
      'merge-workflow-1',
    );
    expect(steps).toEqual([
      'attach-workflow-run',
      'discover',
      'sources:collect',
      'sources:launch:0',
      'sources:launch:1',
      'sources:execute-finalize',
      'merge:launch',
      'merge:execute',
      'merge:finalize',
    ]);
  });

  it('persists a source failure and still merges successful sources', async () => {
    const service = createService();
    service.collectSource.mockImplementation(({ sourceId }) => {
      if (sourceId.startsWith('gmail')) {
        throw new UnderstandingBranchFailureError('gmail unavailable');
      }
      return Promise.resolve({ sourceCount: 1 });
    });

    await expect(
      runOnboardingUnderstandingWorkflow(createContext(initialPayload), {
        createService: async () => service,
      }),
    ).resolves.toEqual({
      merge: 'completed',
      sources: [
        { index: 0, status: 'completed' },
        { index: 1, status: 'failed' },
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

  it('uses stable index-named durable launch steps without provider identifiers', async () => {
    const service = createService();
    service.discover.mockResolvedValue([
      { sourceId: 'github:account-2', threadId: 'thread-2' },
      { sourceId: 'github:account-1', threadId: 'thread-1' },
    ]);
    service.getSourceBranches.mockResolvedValue([
      { sourceId: 'github:account-2', threadId: 'thread-2' },
      { sourceId: 'github:account-1', threadId: 'thread-1' },
    ]);
    const steps: string[] = [];

    await runOnboardingUnderstandingWorkflow(createContext(initialPayload, steps), {
      createService: async () => service,
    });

    expect(steps.filter((step) => step === 'sources:collect')).toHaveLength(1);
    expect(steps.filter((step) => step.startsWith('sources:launch:'))).toEqual([
      'sources:launch:0',
      'sources:launch:1',
    ]);
    expect(steps.join('\n')).not.toMatch(/github|account/);
    expect(steps.filter((step) => step === 'sources:execute-finalize')).toHaveLength(1);
    expect(new Set(steps).size).toBe(steps.length);
  });

  it('replays an acknowledged source launch without launching that source again', async () => {
    const service = createService();
    const steps: string[] = [];
    const context = createContext(initialPayload, steps);
    const run = context.run;
    context.run = async <T>(step: string, handler: () => Promise<T>) => {
      if (step === 'sources:launch:0') {
        steps.push(step);
        return {
          launch: {
            assistantMessageId: 'cached-message',
            operationId: 'cached-operation',
            success: true,
            threadId: 'thread-github',
          },
        } as T;
      }
      return run(step, handler);
    };

    await runOnboardingUnderstandingWorkflow(context, { createService: async () => service });

    expect(service.launchSourceAnalysis).toHaveBeenCalledOnce();
    expect(service.launchSourceAnalysis).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceId: 'gmail:account-1',
      threadId: 'thread-gmail',
      topicId: 'topic-1',
    });
    expect(service.executeAgentOperation).toHaveBeenCalledWith('cached-operation');
  });

  it('keeps source identities and connector data out of every durable and final output', async () => {
    const service = createService();
    service.collectSource.mockResolvedValue({
      sourceBrief: 'PRIVATE_CONNECTOR_DOCUMENT',
      sourceCount: 1,
    });
    service.getSourceBranches.mockResolvedValue([
      { sourceId: 'github:account-1', threadId: 'opaque-thread-0' },
      { sourceId: 'gmail:account-1', threadId: 'opaque-thread-1' },
    ]);
    service.launchSourceAnalysis.mockImplementation(({ sourceId, threadId }) =>
      Promise.resolve({
        assistantMessageId: `opaque-message-${threadId.at(-1)}`,
        operationId: `opaque-operation-${threadId.at(-1)}`,
        sourceId,
        success: true,
        threadId,
      }),
    );
    const durableOutputs: unknown[] = [];
    const context = createContext(initialPayload);
    context.run = async <T>(_step: string, handler: () => Promise<T>) => {
      const output = await handler();
      durableOutputs.push(output);
      return output;
    };

    const result = await runOnboardingUnderstandingWorkflow(context, {
      createService: async () => service,
    });

    const serialized = JSON.stringify({ durableOutputs, result });
    for (const forbidden of [
      'github',
      'gmail',
      'account-1',
      'PRIVATE_CONNECTOR_DOCUMENT',
      'analysis',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
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
        ? Promise.resolve({ status: 'error' as const })
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

  it('persists an adopted merge launch failure against its actual thread', async () => {
    const service = createService();
    service.launchMerge.mockResolvedValue({ failed: true, threadId: 'merge-adopted' });

    await expect(
      runOnboardingUnderstandingWorkflow(createContext(initialPayload), {
        createService: async () => service,
      }),
    ).resolves.toMatchObject({ merge: 'failed' });

    expect(service.failMerge).toHaveBeenCalledWith({
      sessionId: 'session-1',
      threadId: 'merge-adopted',
      topicId: 'topic-1',
    });
    expect(service.executeAgentOperation).toHaveBeenCalledTimes(2);
  });

  it.each(['sources:collect', 'merge:execute'])(
    'rethrows WorkflowAbort from %s without persisting a branch failure',
    async (abortingStep) => {
      const service = createService();
      const context = createContext(initialPayload);
      context.run = async <T>(step: string, handler: () => Promise<T>) => {
        if (step === abortingStep) throw new WorkflowAbort(step);
        return handler();
      };

      await expect(
        runOnboardingUnderstandingWorkflow(context, { createService: async () => service }),
      ).rejects.toBeInstanceOf(WorkflowAbort);
      expect(service.failSource).not.toHaveBeenCalled();
      expect(service.failMerge).not.toHaveBeenCalled();
    },
  );

  it('rethrows unexpected collection infrastructure errors for workflow retry', async () => {
    const service = createService();
    service.collectSource.mockRejectedValue(new Error('database unavailable'));

    await expect(
      runOnboardingUnderstandingWorkflow(createContext(initialPayload), {
        createService: async () => service,
      }),
    ).rejects.toThrow('database unavailable');
    expect(service.failSource).not.toHaveBeenCalled();
    expect(service.failMerge).not.toHaveBeenCalled();
  });
});

describe('createOnboardingUnderstandingWorkflowOptions', () => {
  it('serializes continuation delivery with the trigger session key', () => {
    expect(createOnboardingUnderstandingWorkflowOptions('session:1').flowControl).toEqual({
      key: 'onboarding-understanding.session.session_1',
      parallelism: 1,
    });
  });

  it('terminalizes the persisted session without retaining the failure response', async () => {
    terminalizeUnderstandingWorkflowMock.mockResolvedValue(undefined);

    await expect(
      createOnboardingUnderstandingWorkflowOptions('session-1').failureFunction({
        context: { requestPayload: initialPayload, workflowRunId: 'workflow-1' },
        failHeaders: {},
        failResponse: 'private connector content',
        failStack: 'private stack',
        failStatus: 500,
      } as never),
    ).resolves.toBe('session-terminalized');

    expect(terminalizeUnderstandingWorkflowMock).toHaveBeenCalledWith({
      db: undefined,
      sessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
      workflowRunId: 'workflow-1',
    });
    expect(JSON.stringify(terminalizeUnderstandingWorkflowMock.mock.calls)).not.toContain(
      'private connector content',
    );
  });

  it('returns invalid-payload without opening the database', async () => {
    terminalizeUnderstandingWorkflowMock.mockClear();

    await expect(
      createOnboardingUnderstandingWorkflowOptions('session-1').failureFunction({
        context: { requestPayload: { sessionId: 'session-1' }, workflowRunId: 'workflow-1' },
      } as never),
    ).resolves.toBe('invalid-payload');
    expect(terminalizeUnderstandingWorkflowMock).not.toHaveBeenCalled();
  });

  it('rethrows terminalization failures for Upstash retry and DLQ handling', async () => {
    terminalizeUnderstandingWorkflowMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      createOnboardingUnderstandingWorkflowOptions('session-1').failureFunction({
        context: { requestPayload: initialPayload, workflowRunId: 'workflow-1' },
      } as never),
    ).rejects.toThrow('database unavailable');
  });

  it.each([
    new UnderstandingSessionNotFoundError('topic-1'),
    new StaleUnderstandingSessionError('session-1'),
  ])('treats a removed or replaced reset session as a benign terminal no-op', async (error) => {
    terminalizeUnderstandingWorkflowMock.mockRejectedValueOnce(error);

    await expect(
      createOnboardingUnderstandingWorkflowOptions('session-1').failureFunction({
        context: { requestPayload: initialPayload, workflowRunId: 'workflow-1' },
      } as never),
    ).resolves.toBe('session-not-current');
  });
});

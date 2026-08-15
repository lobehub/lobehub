// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';

// serverDatabase middleware calls getServerDB(); stub it (our model mocks
// ignore the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

// RBAC middleware → pass-through.
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

const mockTopicFindById = vi.fn();
const mockTopicTakeRunningOperation = vi.fn();
const mockTopicCompleteRunningOperation = vi.fn();
const mockTopicReleaseRunningOperationClaim = vi.fn();
const mockTopicUpdateMetadata = vi.fn();
const mockTopicRemoveRunningOperationChild = vi.fn();
const mockMessageFindById = vi.fn();
const mockMessageUpdate = vi.fn();
const mockMessageCreate = vi.fn();
const mockExecAgent = vi.fn();
const mockOpFindById = vi.fn();
const mockInstantiateVerifyPlan = vi.fn();

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: mockOpFindById })),
}));
// Partial mock: keep the real runVerifyOnCompletion (CompletionLifecycle's gate
// imports it from this barrel) and only stub the start-side plan instantiation.
vi.mock('@/server/services/verify', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  instantiateVerifyPlanOnStart: mockInstantiateVerifyPlan,
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({
    findById: mockTopicFindById,
    removeRunningOperationChild: mockTopicRemoveRunningOperationChild,
    takeRunningOperation: mockTopicTakeRunningOperation,
    completeRunningOperation: mockTopicCompleteRunningOperation,
    releaseRunningOperationClaim: mockTopicReleaseRunningOperationClaim,
    updateMetadata: mockTopicUpdateMetadata,
  })),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({
    create: mockMessageCreate,
    findById: mockMessageFindById,
    update: mockMessageUpdate,
  })),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ execAgent: mockExecAgent })),
}));

const mockPublishAgentRuntimeEnd = vi.fn();
const mockPublishStreamEvent = vi.fn();
vi.mock('@/server/modules/AgentRuntime/factory', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  createStreamEventManager: vi.fn(() => ({
    publishAgentRuntimeEnd: mockPublishAgentRuntimeEnd,
    publishStreamEvent: mockPublishStreamEvent,
  })),
}));

// Imported after the mocks above are registered.
const { CompletionLifecycle } = await import('@/server/services/agentRuntime/CompletionLifecycle');
const { agentNotifyRouter } = await import('../agentNotify');

const OP = 'op-remote-1';
const TOPIC = 'topic-remote-1';
const FINAL_MSG_ID = 'msg-final';

const createCaller = () =>
  agentNotifyRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

/** Register spy handlers on the real dispatcher (local mode → in-memory). */
const registerHooks = () => {
  const onComplete = vi.fn(async (_event: any) => {});
  const onError = vi.fn(async (_event: any) => {});
  const hooks: AgentHook[] = [
    { handler: onComplete, id: 'task-on-complete', type: 'onComplete' },
    { handler: onError, id: 'task-on-error', type: 'onError' },
  ];
  hookDispatcher.register(OP, hooks);
  return { onComplete, onError };
};

describe('agentNotifyRouter.notify — remote hetero terminal signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Topic carries the seeded running operation (id + final-reply placeholder).
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          assistantMessageId: FINAL_MSG_ID,
          hooks: [{ id: 'task-on-complete', type: 'onComplete', webhook: { url: '/wh' } }],
          operationId: OP,
        },
      },
    });
    mockTopicTakeRunningOperation.mockResolvedValue({
      isRoot: true,
      operation: {
        assistantMessageId: FINAL_MSG_ID,
        hooks: [{ id: 'task-on-complete', type: 'onComplete', webhook: { url: '/wh' } }],
        operationId: OP,
      },
    });
    // The placeholder message holds the agent's final reply (written in-place
    // by earlier `lh notify` calls).
    mockMessageFindById.mockResolvedValue({ content: 'the final reply', topicId: TOPIC });
    mockTopicUpdateMetadata.mockResolvedValue(undefined);
    mockTopicRemoveRunningOperationChild.mockResolvedValue(undefined);
    mockTopicCompleteRunningOperation.mockResolvedValue(true);
    mockTopicReleaseRunningOperationClaim.mockResolvedValue(true);
    // Default: a non-task op so the plan-instantiation guard no-ops unless a
    // test opts into a task-bound op.
    mockOpFindById.mockResolvedValue({ parentOperationId: null, taskId: null });
    mockInstantiateVerifyPlan.mockResolvedValue(undefined);
  });

  afterEach(() => {
    hookDispatcher.unregister(OP);
  });

  it('empty done signal finalizes success AND carries the final reply into the hooks', async () => {
    const { onComplete, onError } = registerHooks();

    await createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC });

    // Stream closed as success.
    expect(mockPublishAgentRuntimeEnd).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OP, reason: 'success' }),
    );

    // onComplete fired (fire-and-forget) with the reloaded final reply — the
    // regression guard: an empty done signal must still pass the placeholder id
    // so lastAssistantContent isn't undefined (else bot reply + handoff/review/
    // brief get skipped).
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      lastAssistantContent: 'the final reply',
      operationId: OP,
      reason: 'done',
    });
    expect(onError).not.toHaveBeenCalled();

    expect(mockTopicTakeRunningOperation).toHaveBeenCalledWith(TOPIC, OP);
  });

  it('uses the claimed marker snapshot after publishing the terminal event', async () => {
    const completeOperationSpy = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockResolvedValue(undefined);

    await createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC });

    await vi.waitFor(() => expect(completeOperationSpy).toHaveBeenCalledTimes(1));
    expect(completeOperationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orchestrationRole: undefined,
        serializedHooks: expect.arrayContaining([
          expect.objectContaining({ id: 'task-on-complete' }),
        ]),
      }),
      'done',
      expect.anything(),
    );
    // A terminal stream subscriber can clear the live marker immediately. The
    // lifecycle must therefore not issue a second topic lookup for its hooks.
    expect(mockTopicFindById).toHaveBeenCalledTimes(1);
    completeOperationSpy.mockRestore();
  });

  it('settles concurrent terminal retries only once', async () => {
    const completeOperationSpy = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockResolvedValue(undefined);
    mockTopicTakeRunningOperation.mockResolvedValueOnce({
      isRoot: true,
      operation: { assistantMessageId: FINAL_MSG_ID, operationId: OP },
    });
    mockTopicTakeRunningOperation.mockResolvedValueOnce(undefined);

    await Promise.all([
      createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC }),
      createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC }),
    ]);

    await vi.waitFor(() => expect(completeOperationSpy).toHaveBeenCalledTimes(1));
    completeOperationSpy.mockRestore();
  });

  it('rejects a legacy child terminal callback without an operation id', async () => {
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          childOperations: [{ assistantMessageId: 'child-msg', operationId: 'child-op' }],
          operationId: OP,
        },
      },
    });

    const result = await createCaller().notify({
      content: '',
      done: true,
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(result).toEqual({ messageId: undefined, operationId: undefined, topicId: TOPIC });
    expect(mockTopicTakeRunningOperation).not.toHaveBeenCalled();
    expect(mockPublishAgentRuntimeEnd).not.toHaveBeenCalled();
  });

  it('releases a terminal claim when stream publication fails before lifecycle', async () => {
    mockPublishAgentRuntimeEnd.mockRejectedValueOnce(new Error('stream unavailable'));

    await expect(
      createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    await vi.waitFor(() => expect(mockTopicReleaseRunningOperationClaim).toHaveBeenCalledTimes(1));
    expect(mockTopicCompleteRunningOperation).not.toHaveBeenCalled();
  });

  it('durably ensures the verify plan for a task-bound run before the gate', async () => {
    // The start-side plan instantiation (execAgent) is fire-and-forget on a
    // SEPARATE CompletionLifecycle instance, so the completion-side gate here
    // can't await it — a fast remote task could reach the gate before the plan
    // persists and silently skip verify. This path must re-run the idempotent
    // instantiation for a top-level task op so the gate has a plan to read.
    const { onComplete } = registerHooks();
    mockOpFindById.mockResolvedValue({ parentOperationId: null, taskId: 'task-9' });

    await createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC });

    await vi.waitFor(() => expect(mockInstantiateVerifyPlan).toHaveBeenCalledTimes(1));
    // Ensured with the run's own operationId + taskId (3rd arg is the params object).
    expect(mockInstantiateVerifyPlan.mock.calls[0][2]).toMatchObject({
      operationId: OP,
      taskId: 'task-9',
    });
    // Ordered before the gate: the ensure resolves before completeOperation fires
    // onComplete (→ runVerifyOnCompletion).
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(mockInstantiateVerifyPlan.mock.invocationCallOrder[0]).toBeLessThan(
      onComplete.mock.invocationCallOrder[0],
    );
  });

  it('skips verify-plan instantiation for a repair / non-task run', async () => {
    registerHooks();
    // A repair op carries a parentOperationId — its plan comes from the repair
    // path, not the start-side instantiation.
    mockOpFindById.mockResolvedValue({ parentOperationId: 'parent-op', taskId: 'task-9' });

    await createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC });

    expect(mockTopicTakeRunningOperation).toHaveBeenCalledWith(TOPIC, OP);
    expect(mockInstantiateVerifyPlan).not.toHaveBeenCalled();
  });

  it('error signal finalizes the run as failed and fires onError', async () => {
    const { onComplete, onError } = registerHooks();

    await createCaller().notify({
      content: '',
      error: { message: 'remote crashed', type: 'HeteroProcessError' },
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(mockPublishAgentRuntimeEnd).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OP, reason: 'error' }),
    );

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toMatchObject({
      errorMessage: 'remote crashed',
      errorType: 'HeteroProcessError',
      reason: 'error',
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('finalizes a child operation without clearing the supervisor marker', async () => {
    const childOperationId = 'op-child-1';
    const completeOperationSpy = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockResolvedValue(undefined);
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          childOperations: [{ operationId: childOperationId, orchestrationRole: 'member' }],
          operationId: OP,
        },
      },
    });
    mockTopicTakeRunningOperation.mockResolvedValue({
      isRoot: false,
      operation: { operationId: childOperationId, orchestrationRole: 'member' },
    });

    await createCaller().notify({
      content: '',
      done: true,
      operationId: childOperationId,
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(mockPublishAgentRuntimeEnd).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: childOperationId, reason: 'success' }),
    );
    expect(mockTopicTakeRunningOperation).toHaveBeenCalledWith(TOPIC, childOperationId);
    expect(completeOperationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: childOperationId, orchestrationRole: 'member' }),
      'done',
      expect.anything(),
    );
    expect(mockTopicUpdateMetadata).not.toHaveBeenCalledWith(TOPIC, { runningOperation: null });
    completeOperationSpy.mockRestore();
  });

  it('ignores a repeated child terminal callback after its marker was removed', async () => {
    const childOperationId = 'op-child-1';
    const activeTopic = {
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          childOperations: [{ operationId: childOperationId, orchestrationRole: 'member' }],
          operationId: OP,
        },
      },
    };
    const completeOperationSpy = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockResolvedValue(undefined);
    mockTopicFindById.mockResolvedValueOnce(activeTopic).mockResolvedValueOnce(activeTopic);
    mockTopicTakeRunningOperation
      .mockResolvedValueOnce({
        isRoot: false,
        operation: { operationId: childOperationId, orchestrationRole: 'member' },
      })
      .mockResolvedValueOnce(undefined);

    await createCaller().notify({
      content: '',
      done: true,
      operationId: childOperationId,
      role: 'assistant',
      topicId: TOPIC,
    });
    await vi.waitFor(() => expect(completeOperationSpy).toHaveBeenCalledTimes(1));

    const duplicate = await createCaller().notify({
      content: '',
      done: true,
      operationId: childOperationId,
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(duplicate).toEqual({ messageId: undefined, operationId: undefined, topicId: TOPIC });
    expect(completeOperationSpy).toHaveBeenCalledTimes(1);
    completeOperationSpy.mockRestore();
  });

  it('writes a child notification to its own placeholder message', async () => {
    const childOperationId = 'op-child-1';
    const childMessageId = 'msg-child';
    const supervisorMessageId = 'msg-supervisor';
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          assistantMessageId: supervisorMessageId,
          childOperations: [{ assistantMessageId: childMessageId, operationId: childOperationId }],
          operationId: OP,
        },
      },
    });
    mockMessageFindById.mockResolvedValue({ content: '', topicId: TOPIC });

    await createCaller().notify({
      content: 'child response',
      operationId: childOperationId,
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(mockMessageUpdate).toHaveBeenCalledWith(childMessageId, { content: 'child response' });
    expect(mockMessageUpdate).not.toHaveBeenCalledWith(supervisorMessageId, expect.anything());
    expect(mockPublishStreamEvent).toHaveBeenCalledWith(
      childOperationId,
      expect.objectContaining({ type: 'notify_update' }),
    );
  });

  it('writes a child notification to its own placeholder message', async () => {
    const childOperationId = 'op-child-1';
    const childMessageId = 'msg-child';
    const supervisorMessageId = 'msg-supervisor';
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          assistantMessageId: supervisorMessageId,
          childOperations: [{ assistantMessageId: childMessageId, operationId: childOperationId }],
          operationId: OP,
        },
      },
    });
    mockMessageFindById.mockResolvedValue({ content: '', topicId: TOPIC });

    await createCaller().notify({
      content: 'child response',
      operationId: childOperationId,
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(mockMessageUpdate).toHaveBeenCalledWith(childMessageId, { content: 'child response' });
    expect(mockMessageUpdate).not.toHaveBeenCalledWith(supervisorMessageId, expect.anything());
    expect(mockPublishStreamEvent).toHaveBeenCalledWith(
      childOperationId,
      expect.objectContaining({ type: 'notify_update' }),
    );
  });
});

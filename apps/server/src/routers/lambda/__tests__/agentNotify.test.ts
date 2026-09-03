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
// The entry lookup goes through the visitor-excluding twin; by default it
// mirrors `findById` so the existing scenarios keep their single source of
// topic state.
const mockTopicFindOwnTopicById = vi.fn((...args: unknown[]) => mockTopicFindById(...args));
const mockTopicSettleRunningOperation = vi.fn();
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
    findOwnTopicById: mockTopicFindOwnTopicById,
    removeRunningOperationChild: mockTopicRemoveRunningOperationChild,
    settleRunningOperation: mockTopicSettleRunningOperation,
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
    mockTopicSettleRunningOperation.mockResolvedValue({
      isRoot: true,
      status: 'settled',
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
    // Default: a non-task op so the plan-instantiation guard no-ops unless a
    // test opts into a task-bound op.
    mockOpFindById.mockResolvedValue({ parentOperationId: null, taskId: null });
    mockInstantiateVerifyPlan.mockResolvedValue(undefined);
  });

  afterEach(() => {
    hookDispatcher.unregister(OP);
  });

  // Visitor topics carry the creator's userId, so an ownership-only lookup
  // would let a creator-side caller append to or overwrite a visitor
  // transcript through this callback.
  it('rejects an agent-share visitor topic with NOT_FOUND before any write', async () => {
    mockTopicFindOwnTopicById.mockResolvedValueOnce(undefined);

    await expect(
      createCaller().notify({
        content: 'hi',
        messageId: 'msg-1',
        role: 'assistant',
        topicId: TOPIC,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(mockMessageUpdate).not.toHaveBeenCalled();
    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockExecAgent).not.toHaveBeenCalled();
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

    expect(mockTopicSettleRunningOperation).toHaveBeenCalledWith(TOPIC, OP, expect.any(String));
  });

  it('cancelled terminal signal finalizes the run as interrupted', async () => {
    const { onComplete, onError } = registerHooks();

    await createCaller().notify({
      cancelled: true,
      content: '',
      done: true,
      operationId: OP,
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(mockPublishAgentRuntimeEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        finalState: { reason: 'interrupted' },
        operationId: OP,
        reason: 'interrupted',
      }),
    );
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      operationId: OP,
      reason: 'interrupted',
    });
    expect(onError).not.toHaveBeenCalled();
    expect(mockInstantiateVerifyPlan).not.toHaveBeenCalled();
    expect(mockTopicSettleRunningOperation).toHaveBeenCalledWith(TOPIC, OP, expect.any(String));
  });

  it('uses the marker snapshot read before terminal lifecycle completion', async () => {
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
    // The lifecycle must not issue a second topic lookup for its hooks.
    expect(mockTopicFindById).toHaveBeenCalledTimes(1);
    completeOperationSpy.mockRestore();
  });

  it('leaves the marker intact so a failed terminal lifecycle can retry', async () => {
    const completeOperationSpy = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockRejectedValueOnce(new Error('lifecycle failed'))
      .mockResolvedValue(undefined);

    await expect(
      createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(mockPublishAgentRuntimeEnd).not.toHaveBeenCalled();
    expect(mockTopicSettleRunningOperation).not.toHaveBeenCalled();

    await expect(
      createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC }),
    ).resolves.toMatchObject({ messageId: FINAL_MSG_ID, topicId: TOPIC });

    expect(completeOperationSpy).toHaveBeenCalledTimes(2);
    expect(mockPublishAgentRuntimeEnd).toHaveBeenCalledTimes(1);
    expect(mockTopicSettleRunningOperation).toHaveBeenCalledWith(TOPIC, OP, expect.any(String));
    completeOperationSpy.mockRestore();
  });

  it('retries a failed stream publish without firing completion hooks again', async () => {
    const completeOperationSpy = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockResolvedValue(undefined);
    mockTopicFindById
      .mockResolvedValueOnce({
        agentId: 'agent-1',
        metadata: { runningOperation: { operationId: OP, assistantMessageId: FINAL_MSG_ID } },
      })
      .mockResolvedValueOnce({ agentId: 'agent-1', metadata: { runningOperation: null } });
    mockTopicSettleRunningOperation.mockResolvedValueOnce({
      isRoot: true,
      status: 'settled',
      operation: { operationId: OP, assistantMessageId: FINAL_MSG_ID },
    });
    mockOpFindById.mockResolvedValue({
      completedAt: new Date(),
      parentOperationId: null,
      taskId: null,
    });
    mockPublishAgentRuntimeEnd
      .mockRejectedValueOnce(new Error('stream unavailable'))
      .mockResolvedValue(undefined);

    await expect(
      createCaller().notify({
        content: '',
        done: true,
        operationId: OP,
        role: 'assistant',
        topicId: TOPIC,
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    await createCaller().notify({
      content: '',
      done: true,
      operationId: OP,
      role: 'assistant',
      topicId: TOPIC,
    });

    expect(completeOperationSpy).toHaveBeenCalledTimes(1);
    expect(mockPublishAgentRuntimeEnd).toHaveBeenCalledTimes(2);
    expect(mockTopicSettleRunningOperation).toHaveBeenCalledTimes(1);
    completeOperationSpy.mockRestore();
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

    expect(mockTopicSettleRunningOperation).toHaveBeenCalledWith(TOPIC, OP, expect.any(String));
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
    mockTopicSettleRunningOperation.mockResolvedValue({
      isRoot: false,
      status: 'settled',
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
    expect(mockTopicSettleRunningOperation).toHaveBeenCalledWith(
      TOPIC,
      childOperationId,
      expect.any(String),
    );
    expect(completeOperationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: childOperationId, orchestrationRole: 'member' }),
      'done',
      expect.anything(),
    );
    expect(mockTopicUpdateMetadata).not.toHaveBeenCalledWith(TOPIC, { runningOperation: null });
    completeOperationSpy.mockRestore();
  });

  it('accepts a legacy callback when there is one remote child', async () => {
    const childOperationId = 'op-child-legacy';
    const completeOperationSpy = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockResolvedValue(undefined);
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          childOperations: [
            { operationId: childOperationId, heteroType: 'openclaw', orchestrationRole: 'member' },
          ],
          operationId: OP,
        },
      },
    });
    mockTopicSettleRunningOperation.mockResolvedValue({
      isRoot: false,
      status: 'settled',
      operation: { operationId: childOperationId, orchestrationRole: 'member' },
    });

    await createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC });

    expect(completeOperationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: childOperationId }),
      'done',
      expect.anything(),
    );
    expect(mockTopicSettleRunningOperation).toHaveBeenCalledWith(
      TOPIC,
      childOperationId,
      expect.any(String),
    );
    completeOperationSpy.mockRestore();
  });

  it('requires operationId when multiple remote children are active', async () => {
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      metadata: {
        runningOperation: {
          childOperations: [
            { operationId: 'op-child-1', heteroType: 'openclaw', orchestrationRole: 'member' },
            { operationId: 'op-child-2', heteroType: 'hermes', orchestrationRole: 'member' },
          ],
          operationId: OP,
        },
      },
    });

    await expect(
      createCaller().notify({ content: '', done: true, role: 'assistant', topicId: TOPIC }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mockTopicSettleRunningOperation).not.toHaveBeenCalled();
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
    mockTopicFindById.mockResolvedValueOnce(activeTopic).mockResolvedValueOnce({
      ...activeTopic,
      metadata: {
        runningOperation: {
          childOperations: [],
          operationId: OP,
        },
      },
    });
    mockTopicSettleRunningOperation
      .mockResolvedValueOnce({
        isRoot: false,
        status: 'settled',
        operation: { operationId: childOperationId, orchestrationRole: 'member' },
      })
      .mockResolvedValueOnce({ status: 'missing' });

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
});

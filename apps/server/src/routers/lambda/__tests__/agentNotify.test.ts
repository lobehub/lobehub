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
const mockTopicUpdateMetadata = vi.fn();
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
    // The placeholder message holds the agent's final reply (written in-place
    // by earlier `lh notify` calls).
    mockMessageFindById.mockResolvedValue({ content: 'the final reply', topicId: TOPIC });
    mockTopicUpdateMetadata.mockResolvedValue(undefined);
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

    // Running marker dropped so a duplicate done can't re-fire.
    await vi.waitFor(() =>
      expect(mockTopicUpdateMetadata).toHaveBeenCalledWith(TOPIC, { runningOperation: null }),
    );
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

    await vi.waitFor(() =>
      expect(mockTopicUpdateMetadata).toHaveBeenCalledWith(TOPIC, { runningOperation: null }),
    );
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
});

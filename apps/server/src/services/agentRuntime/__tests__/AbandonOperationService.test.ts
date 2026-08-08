// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbandonOperationService } from '../AbandonOperationService';

const buildStore = () => ({
  get: vi.fn(),
  getLatest: vi.fn(),
  list: vi.fn(),
  listPartials: vi.fn(),
  loadPartial: vi.fn(),
  removePartial: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  savePartial: vi.fn().mockResolvedValue(undefined),
});

const buildCoordinator = (
  overrides: Partial<{
    loadAgentState: ReturnType<typeof vi.fn>;
    deleteAgentOperation: ReturnType<typeof vi.fn>;
  }> = {},
) => ({
  loadAgentState: vi.fn(),
  deleteAgentOperation: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const messageUpdateMock = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({ update: messageUpdateMock })),
}));

const findOperationMock = vi.fn().mockResolvedValue(null);
const recordCompletionMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(() => ({
    findById: findOperationMock,
    recordCompletion: recordCompletionMock,
  })),
}));

const dispatchHooksMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../CompletionLifecycle', () => ({
  CompletionLifecycle: vi.fn().mockImplementation(() => ({
    dispatchHooks: dispatchHooksMock,
  })),
}));

const findThreadMock = vi.fn().mockResolvedValue(null);
vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({ findById: findThreadMock })),
}));

const topicFindByIdMock = vi.fn().mockResolvedValue(null);
const topicUpdateMetadataMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    findById: topicFindByIdMock,
    updateMetadata: topicUpdateMetadataMock,
  })),
}));

const stateWith = (overrides: Record<string, any> = {}) => ({
  cost: { total: 0.1 },
  metadata: {
    agentId: 'agt_x',
    assistantMessageId: 'msg_assist_1',
    topicId: 'tpc_x',
    userId: 'user_x',
  },
  status: 'running',
  stepCount: 5,
  usage: { llm: { tokens: { total: 1000 } } },
  ...overrides,
});

const buildDb = (overrides: { assistantRow?: any; operationRow?: any } = {}) =>
  ({
    query: {
      agentOperations: {
        findFirst: vi.fn().mockResolvedValue(overrides.operationRow ?? null),
      },
      messages: {
        findFirst: vi.fn().mockResolvedValue(overrides.assistantRow ?? null),
      },
    },
  }) as any;

describe('AbandonOperationService', () => {
  beforeEach(() => {
    messageUpdateMock.mockClear();
    dispatchHooksMock.mockClear();
    findOperationMock.mockReset().mockResolvedValue(null);
    recordCompletionMock.mockClear();
    findThreadMock.mockReset().mockResolvedValue(null);
    topicFindByIdMock.mockReset().mockResolvedValue(null);
    topicUpdateMetadataMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns found:false when coordinator has no state', async () => {
    const coord = buildCoordinator({ loadAgentState: vi.fn().mockResolvedValue(null) });
    const store = buildStore();
    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_missing', 'inactivity_5m');

    expect(result).toEqual({
      assistantMessageUpdated: false,
      finalized: false,
      found: false,
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it('marks a no-state running operation as abandoned and errors the placeholder', async () => {
    const coord = buildCoordinator({ loadAgentState: vi.fn().mockResolvedValue(null) });
    const store = buildStore();
    const db = buildDb({
      operationRow: {
        agentId: 'agt_x',
        id: 'op_x',
        provider: 'claude-code',
        startedAt: new Date('2026-06-30T11:51:14.745Z'),
        status: 'running',
        topicId: 'tpc_x',
        userId: 'user_x',
        workspaceId: 'ws_x',
      },
    });
    topicFindByIdMock.mockResolvedValue({
      metadata: {
        runningOperation: {
          assistantMessageId: 'msg_assist_1',
          operationId: 'op_x',
        },
      },
    });

    const svc = new AbandonOperationService(db, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'inactivity_watchdog');

    expect(result).toMatchObject({
      abandoned: true,
      assistantMessageUpdated: true,
      finalized: false,
      found: false,
    });
    expect(recordCompletionMock).toHaveBeenCalledWith(
      'op_x',
      expect.objectContaining({
        completionReason: 'error',
        status: 'error',
        stepCount: 0,
        toolCalls: 0,
      }),
    );
    expect(topicUpdateMetadataMock).toHaveBeenCalledWith('tpc_x', { runningOperation: null });
    expect(messageUpdateMock).toHaveBeenCalledWith('msg_assist_1', {
      content: '',
      error: expect.objectContaining({
        message: expect.stringContaining('inactivity_watchdog'),
        type: 'AgentRuntimeError',
      }),
    });
  });

  it('keeps no-state terminal operations classified as completed phantom timeouts', async () => {
    const coord = buildCoordinator({ loadAgentState: vi.fn().mockResolvedValue(null) });
    const store = buildStore();
    const db = buildDb({
      operationRow: {
        id: 'op_done',
        status: 'done',
        userId: 'user_x',
      },
    });

    const svc = new AbandonOperationService(db, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_done', 'inactivity_watchdog');

    expect(result.abandoned).toBeUndefined();
    expect(recordCompletionMock).not.toHaveBeenCalled();
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it('does not touch a newer runningOperation when abandoning an old no-state op', async () => {
    const coord = buildCoordinator({ loadAgentState: vi.fn().mockResolvedValue(null) });
    const store = buildStore();
    const db = buildDb({
      assistantRow: { id: 'msg_old_placeholder' },
      operationRow: {
        agentId: 'agt_x',
        id: 'op_old',
        provider: 'claude-code',
        startedAt: new Date('2026-06-30T11:51:14.745Z'),
        status: 'running',
        topicId: 'tpc_x',
        userId: 'user_x',
      },
    });
    topicFindByIdMock.mockResolvedValue({
      metadata: {
        runningOperation: {
          assistantMessageId: 'msg_new_placeholder',
          operationId: 'op_new',
        },
      },
    });

    const svc = new AbandonOperationService(db, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_old', 'inactivity_watchdog');

    expect(result.abandoned).toBe(true);
    expect(recordCompletionMock).toHaveBeenCalled();
    expect(topicUpdateMetadataMock).not.toHaveBeenCalled();
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it('finalizes snapshot and marks assistant message errored when state + partial exist', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({
      model: 'deepseek-v4-pro',
      provider: 'lobehub',
      startedAt: 1_777_991_958_128,
      steps: [
        { stepIndex: 0, stepType: 'call_llm' },
        { stepIndex: 1, stepType: 'call_tool' },
      ],
    });
    topicFindByIdMock.mockResolvedValue({
      metadata: {
        runningOperation: {
          assistantMessageId: 'msg_assist_1',
          operationId: 'op_x',
        },
      },
    });

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'inactivity_5m');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.assistantMessageUpdated).toBe(true);

    // Final snapshot saved
    expect(store.save).toHaveBeenCalledTimes(1);
    const saved = store.save.mock.calls[0][0];
    expect(saved.operationId).toBe('op_x');
    expect(saved.error?.type).toBe('AgentRuntimeError');
    expect(saved.error?.message).toContain('inactivity_5m');
    expect(saved.completionReason).toBe('error');
    // failedStep synthesized at lastIndex+1
    expect(saved.steps).toHaveLength(3);
    const synth = saved.steps[2];
    expect(synth.stepIndex).toBe(2);
    expect(synth.events?.[0]?.type).toBe('error');

    // Partial cleaned up
    expect(store.removePartial).toHaveBeenCalledWith('op_x');

    // Assistant message updated
    expect(messageUpdateMock).toHaveBeenCalledWith('msg_assist_1', {
      error: expect.objectContaining({
        message: expect.stringContaining('inactivity_5m'),
        type: 'AgentRuntimeError',
      }),
    });
    expect(topicUpdateMetadataMock).toHaveBeenCalledWith('tpc_x', { runningOperation: null });
    expect(dispatchHooksMock).toHaveBeenCalledWith(
      'op_x',
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('inactivity_5m'),
          type: 'AgentRuntimeError',
        }),
        status: 'error',
      }),
      'error',
      { skipErrorMessageWrite: true },
    );

    // Coordinator state cleaned
    expect(coord.deleteAgentOperation).toHaveBeenCalledWith('op_x');
  });

  it.each(['done', 'error', 'interrupted'])(
    'skips abandoned lifecycle dispatch for terminal coordinator state %s',
    async (status) => {
      const coord = buildCoordinator({
        loadAgentState: vi.fn().mockResolvedValue(stateWith({ status })),
      });
      const store = buildStore();
      store.loadPartial.mockResolvedValue(null);
      topicFindByIdMock.mockResolvedValue({
        metadata: {
          runningOperation: {
            assistantMessageId: 'msg_assist_1',
            operationId: 'op_x',
          },
        },
      });

      const svc = new AbandonOperationService({} as any, {
        coordinator: coord as any,
        snapshotStore: store as any,
      });

      const result = await svc.finalizeAbandoned('op_x', 'inactivity_5m');

      expect(result.found).toBe(true);
      expect(topicUpdateMetadataMock).toHaveBeenCalledWith('tpc_x', { runningOperation: null });
      expect(dispatchHooksMock).not.toHaveBeenCalled();
    },
  );

  it('skips snapshot finalize when no partial exists but still updates message', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue(null);

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'inactivity_5m');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(false); // partial was missing
    expect(result.assistantMessageUpdated).toBe(true);
    expect(store.save).not.toHaveBeenCalled();
    expect(messageUpdateMock).toHaveBeenCalled();
  });

  it('synthesizes failedStep at index 0 when partial has zero steps', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({ steps: [], startedAt: 1 });

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    await svc.finalizeAbandoned('op_x', 'reason');

    const saved = store.save.mock.calls[0][0];
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps[0].stepIndex).toBe(0);
  });

  it('does not crash when state has no metadata.assistantMessageId', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith({ metadata: { userId: 'user_x' } })),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({ steps: [{ stepIndex: 0 }], startedAt: 1 });

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'reason');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.assistantMessageUpdated).toBe(false);
    expect(messageUpdateMock).not.toHaveBeenCalled();
  });

  it('treats non-fatal errors during message update / coordinator cleanup as best-effort', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
      deleteAgentOperation: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue({ steps: [{ stepIndex: 0 }], startedAt: 1 });
    messageUpdateMock.mockRejectedValueOnce(new Error('db down'));

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    // Should not throw — both failure paths are caught & logged
    const result = await svc.finalizeAbandoned('op_x', 'reason');

    expect(result.found).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.assistantMessageUpdated).toBe(false);
  });

  it('surfaces subAgentResume linkage when an abandoned op is a sub-agent', async () => {
    findOperationMock.mockResolvedValue({
      parentOperationId: 'op_parent',
      threadId: 'thread_1',
    });
    findThreadMock.mockResolvedValue({ sourceMessageId: 'msg_tool_placeholder' });

    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(
        stateWith({
          metadata: {
            assistantMessageId: 'msg_assist_1',
            isSubAgent: true,
            threadId: 'thread_1',
            userId: 'user_x',
            workspaceId: 'ws_1',
          },
        }),
      ),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue(null);

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_child', 'inactivity_watchdog');

    expect(result.subAgentResume).toEqual({
      parentOperationId: 'op_parent',
      threadId: 'thread_1',
      toolMessageId: 'msg_tool_placeholder',
      userId: 'user_x',
      workspaceId: 'ws_1',
    });
    expect(dispatchHooksMock).not.toHaveBeenCalled();
    // Coordinator state is kept alive so the durable parent-resume can still
    // resolve this op's userId; it expires via its own Redis TTL.
    expect(coord.deleteAgentOperation).not.toHaveBeenCalled();
  });

  it('omits subAgentResume for an isolated group member (orchestrationRole=member)', async () => {
    findOperationMock.mockResolvedValue({
      parentOperationId: 'op_supervisor',
      threadId: 'thread_g',
    });
    findThreadMock.mockResolvedValue({ sourceMessageId: 'msg_group_anchor' });

    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(
        stateWith({
          metadata: {
            assistantMessageId: 'msg_assist_1',
            isSubAgent: true,
            orchestrationRole: 'member',
            threadId: 'thread_g',
            userId: 'user_x',
            workspaceId: 'ws_1',
          },
        }),
      ),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue(null);

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_member', 'inactivity_watchdog');

    // Group members are resumed via the group K=N bridge (their own timeout),
    // not the sub-agent bridge — so we must NOT surface subAgentResume, and the
    // coordinator state is cleaned up normally.
    expect(result.subAgentResume).toBeUndefined();
    expect(findOperationMock).not.toHaveBeenCalled();
    expect(coord.deleteAgentOperation).toHaveBeenCalledWith('op_member');
  });

  it('omits subAgentResume for a non-sub-agent abandoned op', async () => {
    const coord = buildCoordinator({
      loadAgentState: vi.fn().mockResolvedValue(stateWith()),
    });
    const store = buildStore();
    store.loadPartial.mockResolvedValue(null);

    const svc = new AbandonOperationService({} as any, {
      coordinator: coord as any,
      snapshotStore: store as any,
    });

    const result = await svc.finalizeAbandoned('op_x', 'reason');

    expect(result.subAgentResume).toBeUndefined();
    expect(findOperationMock).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';

import { TaskResultBridgeService } from './index';

// `MessageModel.create` is a class-field arrow (instance prop, not on the
// prototype) and `AiAgentService`'s constructor builds many sub-services — mock
// both modules so we observe the calls without standing up the real graph.
const {
  attachCreatorOperation,
  claimPending,
  createMsg,
  createPending,
  execAgent,
  findMessage,
  getLastLeaf,
  release,
  settle,
  topicFindById,
  releaseReservation,
  tryReserve,
} = vi.hoisted(() => ({
  attachCreatorOperation: vi.fn(),
  claimPending: vi.fn(),
  createMsg: vi.fn(),
  createPending: vi.fn(),
  execAgent: vi.fn(),
  findMessage: vi.fn(),
  getLastLeaf: vi.fn(),
  releaseReservation: vi.fn(),
  tryReserve: vi.fn(),
  release: vi.fn(),
  settle: vi.fn(),
  topicFindById: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({
    create: createMsg,
    findById: findMessage,
    getLastMainThreadSpineMessageId: getLastLeaf,
  })),
}));

vi.mock('./redisStore', () => ({
  TaskResultCallbackRedisStore: vi.fn(() => ({
    attachCreatorOperation,
    claimPending,
    createPending,
    release,
    settle,
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({
    findById: topicFindById,
    releaseTaskCallbackReservation: releaseReservation,
    tryReserveTaskCallback: tryReserve,
  })),
}));

vi.mock('../aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ execAgent })),
}));

const TEST_USER = 'user-1';
const db = {
  transaction: vi.fn(async (callback) => callback({ execute: vi.fn() })),
} as any;

const ORIGIN = {
  agentId: 'agent-creator',
  messageId: 'msg-anchor',
  operationId: 'op-creator',
  toolCallId: 'tc-1',
  topicId: 'topic-origin',
};

const baseParams = {
  operationId: 'op-task',
  reason: 'done',
  taskId: 'task-1',
  taskIdentifier: 'T-1',
  topicId: 'topic-done',
};

describe('TaskResultBridgeService.deliver', () => {
  // Loosely typed: vi.spyOn's generic MockInstance isn't assignable from the
  // method-specific spy types (TaskModel.findById / TaskTopicModel.findByTopicId).
  let findById: any;
  let findByTopicId: any;

  beforeEach(() => {
    createMsg.mockReset().mockResolvedValue({ id: 'task-cb-task-1-topic-done' } as any);
    createPending.mockReset().mockResolvedValue({ id: 'receipt-1' });
    claimPending
      .mockReset()
      .mockResolvedValue([{ callbackMessageId: 'task-cb-task-1-topic-done', id: 'receipt-1' }]);
    attachCreatorOperation.mockReset().mockResolvedValue(undefined);
    release.mockReset().mockResolvedValue(undefined);
    settle.mockReset().mockResolvedValue('topic-origin');
    findMessage.mockReset().mockResolvedValue(null);
    topicFindById.mockReset().mockResolvedValue({ agentId: 'agent-creator', metadata: {} });
    // The creator topic's current leaf at delivery time — the live tail of the
    // conversation, NOT origin.messageId (the stale create-task message).
    getLastLeaf
      .mockReset()
      .mockResolvedValueOnce('msg-current-leaf')
      .mockResolvedValue('task-cb-task-1-topic-done');
    tryReserve.mockReset().mockResolvedValue(true);
    releaseReservation.mockReset().mockResolvedValue(undefined);
    execAgent
      .mockReset()
      .mockResolvedValue({ operationId: 'op-new', topicId: 'topic-origin' } as any);
    findById = vi.spyOn(TaskModel.prototype, 'findById').mockResolvedValue({
      automationMode: null,
      context: { origin: ORIGIN },
      status: 'running',
    } as any);
    findByTopicId = vi.spyOn(TaskTopicModel.prototype, 'findByTopicId').mockResolvedValue({
      handoff: {
        keyFindings: ['a', 'b'],
        nextAction: 'ship it',
        summary: 'Fixed the null deref',
        title: 'Fix',
      },
    } as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it('appends a taskCallback card to the origin topic and runs the creator agent off history', async () => {
    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).toHaveBeenCalledTimes(1);
    const [params, id] = createMsg.mock.calls[0] as [any, string];
    expect(params).toMatchObject({
      agentId: 'agent-creator',
      // anchored on the topic's live leaf, not origin.messageId ('msg-anchor')
      parentId: 'msg-current-leaf',
      role: 'taskCallback',
      topicId: 'topic-origin',
    });
    expect(params.metadata.taskCallback).toMatchObject({
      identifier: 'T-1',
      reason: 'done',
      taskId: 'task-1',
      topicId: 'topic-done',
    });
    expect(params.content).toContain('Fixed the null deref');
    expect(params.content).toContain('ship it');
    // deterministic id keyed on (task, completed topic) for idempotency
    expect(id).toBe('task-cb-task-1-topic-done');

    expect(execAgent).toHaveBeenCalledTimes(1);
    expect(execAgent.mock.calls[0][0]).toMatchObject({
      agentId: 'agent-creator',
      appContext: { topicId: 'topic-origin' },
      parentMessageId: 'task-cb-task-1-topic-done',
      suppressUserMessage: true,
    });
    expect(releaseReservation).toHaveBeenCalledWith('topic-origin', 'task-result-wakeup-receipt-1');
  });

  it('scopes the MessageModel to the bridge workspace so workspace tasks find their leaf', async () => {
    await new TaskResultBridgeService(db, TEST_USER, 'ws-1').deliver(baseParams);

    // Personal-mode model (workspace_id IS NULL) would miss the team topic's
    // leaf and create the callback parentless — the lookup must be ws-scoped.
    expect(MessageModel).toHaveBeenCalledWith(expect.anything(), TEST_USER, 'ws-1');
    expect(TopicModel).toHaveBeenCalledWith(db, TEST_USER, 'ws-1');
  });

  it('skips tasks with no origin (e.g. API-created)', async () => {
    findById.mockResolvedValue({ context: {}, status: 'completed' } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).not.toHaveBeenCalled();
    expect(execAgent).not.toHaveBeenCalled();
  });

  it('does not wake the creator when the origin topic was deleted', async () => {
    tryReserve.mockResolvedValue(null);

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createPending).toHaveBeenCalledTimes(1);
    expect(execAgent).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(['receipt-1']);
  });

  it('resumes an incomplete wakeup when the callback message already exists', async () => {
    findMessage.mockResolvedValueOnce({ id: 'task-cb-task-1-topic-done' });

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).not.toHaveBeenCalled();
    expect(createPending).toHaveBeenCalledTimes(1);
    expect(execAgent).toHaveBeenCalledTimes(1);
  });

  it('waits for the in-flight tool turn before resolving the callback parent', async () => {
    vi.useFakeTimers();
    try {
      tryReserve.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const delivery = new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);
      await vi.waitFor(() => expect(tryReserve).toHaveBeenCalledTimes(1));

      expect(execAgent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      await delivery;

      expect(tryReserve).toHaveBeenCalledTimes(2);
      expect(getLastLeaf).toHaveBeenCalledTimes(2);
      expect(tryReserve.mock.invocationCallOrder.at(-1)).toBeLessThan(
        getLastLeaf.mock.invocationCallOrder[1],
      );
      expect(createMsg.mock.calls[0][0]).toMatchObject({ parentId: 'msg-current-leaf' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the reservation until the callback continuation is dispatched', async () => {
    let finishDispatch: (() => void) | undefined;
    execAgent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDispatch = () => resolve({ operationId: 'op-new', topicId: 'topic-origin' } as any);
        }),
    );

    const delivery = new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);
    await vi.waitFor(() => expect(execAgent).toHaveBeenCalledTimes(1));

    expect(releaseReservation).not.toHaveBeenCalled();

    finishDispatch?.();
    await delivery;

    expect(releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('stops waiting after bounded retries so QStash can redeliver the callback', async () => {
    vi.useFakeTimers();
    try {
      tryReserve.mockResolvedValue(false);

      const delivery = new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);
      const expectation = expect(delivery).rejects.toThrow('Topic topic-origin remained busy');

      await vi.runAllTimersAsync();
      await expectation;

      expect(tryReserve).toHaveBeenCalledTimes(6);
      expect(createMsg).toHaveBeenCalledTimes(1);
      expect(execAgent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores messenger routing and registers a proactive bot completion hook', async () => {
    topicFindById.mockResolvedValue({
      agentId: 'agent-creator',
      metadata: {
        bot: {
          applicationId: 'messenger-discord',
          isOwner: true,
          messengerInstallationKey: 'discord:singleton',
          platform: 'discord',
          platformThreadId: 'discord:guild:channel:thread',
          senderExternalUserId: 'discord-user',
        },
      },
    });

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    const hooks = execAgent.mock.calls[0][0].hooks;
    const botHook = hooks.find((hook: any) => hook.id === 'task-creator-completion');
    expect(botHook.webhook).toMatchObject({
      delivery: 'qstash',
      fallback: 'none',
      url: '/api/workflows/task/on-creator-complete',
    });
    expect(botHook.webhook.body).toMatchObject({
      messengerInstallationKey: 'discord:singleton',
      platformThreadId: 'discord:guild:channel:thread',
      type: 'completion',
    });
  });

  it('aggregates all pending callbacks into one creator wakeup', async () => {
    claimPending.mockResolvedValue([
      { callbackMessageId: 'callback-1', id: 'receipt-1' },
      { callbackMessageId: 'callback-2', id: 'receipt-2' },
    ]);
    getLastLeaf
      .mockReset()
      .mockResolvedValueOnce('msg-current-leaf')
      .mockResolvedValue('callback-2');

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(execAgent).toHaveBeenCalledTimes(1);
    expect(execAgent.mock.calls[0][0]).toMatchObject({
      parentMessageId: 'callback-2',
      prompt: 'Process 2 completed task results',
    });
    expect(attachCreatorOperation).toHaveBeenCalledWith(['receipt-1', 'receipt-2'], 'op-new');
  });

  it('bridges a failed run with the error text and reason', async () => {
    findByTopicId.mockResolvedValue({ handoff: undefined } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver({
      ...baseParams,
      errorMessage: 'boom: provider 500',
      reason: 'error',
    });

    const [params] = createMsg.mock.calls[0] as [any, string];
    expect(params.metadata.taskCallback.reason).toBe('error');
    expect(params.content).toContain('boom: provider 500');
  });

  it('defers automation tasks until the task itself is terminal', async () => {
    findById.mockResolvedValue({
      automationMode: 'schedule',
      context: { origin: ORIGIN },
      status: 'running',
    } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).not.toHaveBeenCalled();
    expect(execAgent).not.toHaveBeenCalled();
  });

  // The bridge runs from onTopicComplete AFTER status transitions, so a
  // scheduled task that hit its cap is already `completed` when we read it —
  // the callback must NOT be dropped (the race that this fix closes).
  it('bridges an automation task once it has reached a terminal status', async () => {
    findById.mockResolvedValue({
      automationMode: 'schedule',
      context: { origin: ORIGIN },
      status: 'completed',
    } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver(baseParams);

    expect(createMsg).toHaveBeenCalledTimes(1);
    expect(execAgent).toHaveBeenCalledTimes(1);
  });

  it('falls back to lastAssistantContent when the handoff is not yet written (cloud race)', async () => {
    findByTopicId.mockResolvedValue({ handoff: undefined } as any);

    await new TaskResultBridgeService(db, TEST_USER).deliver({
      ...baseParams,
      lastAssistantContent: 'Raw final output from the run',
    });

    const [params] = createMsg.mock.calls[0] as [any, string];
    expect(params.content).toContain('Raw final output from the run');
  });
});

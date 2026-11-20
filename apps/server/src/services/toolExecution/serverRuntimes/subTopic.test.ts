// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subTopicRuntime } from './subTopic';

const mocks = vi.hoisted(() => ({
  archiveUpdate: vi.fn(),
  assertAgent: vi.fn(),
  assertParent: vi.fn(),
  assertUseTopic: vi.fn(),
  assertViewTopic: vi.fn(),
  execAgent: vi.fn(),
  findById: vi.fn(),
  findOwnLiveRuns: vi.fn(),
  interruptTask: vi.fn(),
  isOpenedBy: vi.fn(),
  labOn: vi.fn(async () => true),
  listOpenedTopics: vi.fn(),
  onlyViewable: vi.fn(),
  queueAppend: vi.fn(),
  retireChildTopics: vi.fn(),
  startComposerRun: vi.fn(),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return {
      findById: mocks.findById,
      isOpenedBy: mocks.isOpenedBy,
      listOpenedTopics: mocks.listOpenedTopics,
    };
  }),
}));
vi.mock('@/database/models/message', () => ({ MessageModel: vi.fn() }));
vi.mock('@/server/routers/lambda/_helpers/conversationResourceGuard', () => ({
  assertCanUseTopicTargets: mocks.assertUseTopic,
  assertCanViewTopicTargets: mocks.assertViewTopic,
}));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: mocks.assertAgent,
}));
vi.mock('@/server/routers/lambda/aiAgent/guards', () => ({
  assertCanUseAgentRunConversation: mocks.assertParent,
}));
vi.mock('@/server/routers/lambda/agentSteerQueue', () => ({
  agentSteerQueueRouter: { createCaller: () => ({ append: mocks.queueAppend }) },
}));
vi.mock('@/server/routers/lambda/topic/childTopics', () => ({
  onlyViewableChildTopics: mocks.onlyViewable,
  RETIRED_TOPIC_STATUSES: ['completed', 'archived'],
  retireChildTopics: mocks.retireChildTopics,
  toSubTopicState: () => 'idle',
}));
vi.mock('@/server/routers/lambda/topic/transcript', () => ({ readTopicTranscript: vi.fn() }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { execAgent: mocks.execAgent, interruptTask: mocks.interruptTask };
  }),
}));
vi.mock('@/server/services/aiAgent/composerRun', () => ({
  startComposerRun: mocks.startComposerRun,
}));
vi.mock('@/server/services/aiAgent/foregroundIntervention', () => ({
  resolveForegroundInterventionConfig: vi.fn(async () => ({ approvalMode: 'auto-run' })),
}));
vi.mock('@/server/services/aiAgent/steerQueue/liveRuns', () => ({
  findOwnLiveRuns: mocks.findOwnLiveRuns,
}));
vi.mock('@/server/services/subTopic/labGate', () => ({ readSubTopicsEnabled: mocks.labOn }));
vi.mock('@/server/services/topicArchive', () => ({
  TopicArchiveService: vi.fn(function () {
    return { updateTopic: mocks.archiveUpdate };
  }),
}));
vi.mock('@/server/services/trash', () => ({ TrashService: vi.fn() }));

const runtime = (extra: Record<string, unknown> = {}) =>
  subTopicRuntime.factory({
    operationId: 'op_parent',
    serverDB: {} as any,
    topicId: 'tpc_parent',
    userId: 'user-1',
    ...extra,
  } as any);

const externalSender = {
  botContext: {
    applicationId: 'app-1',
    isOwner: false,
    platform: 'discord',
    platformThreadId: 'thread-1',
    senderExternalUserId: 'stranger',
  },
};

describe('lobe-topic server runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockImplementation(async (id: string) => ({
      agentId: 'agt_lobe',
      id,
      metadata: {},
    }));
    mocks.execAgent.mockResolvedValue({
      operationId: 'op_child',
      success: true,
      topicId: 'tpc_new',
    });
    mocks.findOwnLiveRuns.mockResolvedValue(['op_a']);
    mocks.interruptTask.mockResolvedValue({ success: true });
  });

  it('opens a sub-topic as an ordinary new topic with a parent, sharing its directory', async () => {
    const result = await runtime().openTopic({ prompt: 'Fix the flaky test', title: 'Flaky' });

    expect(result.success).toBe(true);
    expect(mocks.assertAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_lobe' }),
    );
    expect(mocks.assertParent).toHaveBeenCalledWith(
      expect.objectContaining({ openedByTopicId: 'tpc_parent' }),
    );
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_lobe',
        openedByTopicId: 'tpc_parent',
        parentWorkspace: 'inherit',
        prompt: 'Fix the flaky test',
        sourceOperationId: 'op_parent',
        title: 'Flaky',
        userInterventionConfig: { approvalMode: 'auto-run' },
      }),
    );
  });

  it('requires a named device, and links nothing when detached', async () => {
    await runtime().openTopic({ deviceId: 'dev_linux', detach: true, prompt: 'x' });

    const params = mocks.execAgent.mock.calls[0][0];
    expect(params).toMatchObject({ deviceId: 'dev_linux', requireDevice: true });
    expect(params).not.toHaveProperty('openedByTopicId');
    expect(params).not.toHaveProperty('parentWorkspace');
  });

  it('starts nothing when the caller may not use the agent', async () => {
    mocks.assertAgent.mockRejectedValueOnce(new Error('FORBIDDEN'));

    const result = await runtime().openTopic({ agentId: 'agt_locked', prompt: 'x' });

    expect(result.success).toBe(false);
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('acts only on sub-topics of the conversation it runs in', async () => {
    mocks.isOpenedBy.mockResolvedValue(false);

    const result = await runtime().stopTopic({ topicId: 'tpc_someone_else' });

    expect(mocks.isOpenedBy).toHaveBeenCalledWith('tpc_someone_else', 'tpc_parent');
    expect(result.success).toBe(false);
    expect(mocks.interruptTask).not.toHaveBeenCalled();
  });

  it('stops a sub-topic through interruptTask, and says so when a stop is unconfirmed', async () => {
    mocks.isOpenedBy.mockResolvedValue(true);

    expect((await runtime().stopTopic({ topicId: 'tpc_child' })).success).toBe(true);
    expect(mocks.interruptTask).toHaveBeenCalledWith({ operationId: 'op_a', topicId: 'tpc_child' });

    mocks.interruptTask.mockResolvedValueOnce({ success: false });
    const unconfirmed = await runtime().stopTopic({ topicId: 'tpc_child' });
    expect(unconfirmed.success).toBe(false);
    expect(unconfirmed.content).toMatch(/could not be confirmed stopped/);
  });

  it('archives a sub-topic, moving its own sub-topics to the top level first', async () => {
    mocks.isOpenedBy.mockResolvedValue(true);

    await runtime().archiveTopic({ topicId: 'tpc_child' });

    expect(mocks.retireChildTopics).toHaveBeenCalledWith(expect.anything(), {
      action: 'archive',
      mode: 'detach',
      topicId: 'tpc_child',
    });
    expect(mocks.archiveUpdate).toHaveBeenCalledWith('tpc_child', {
      completedAt: expect.any(Date),
      status: 'completed',
    });
  });

  it('refuses to open or continue a sub-topic for a bot sender who is denied devices', async () => {
    mocks.isOpenedBy.mockResolvedValue(true);

    const opened = await runtime(externalSender).openTopic({ prompt: 'run the deploy script' });
    expect(opened.success).toBe(false);
    expect(opened.content).toMatch(/bot owner or a trusted sender/);

    const sent = await runtime(externalSender).sendToTopic({ message: 'hi', topicId: 'tpc_child' });
    expect(sent.success).toBe(false);
    expect(mocks.execAgent).not.toHaveBeenCalled();

    // Stopping one is still allowed.
    expect((await runtime(externalSender).stopTopic({ topicId: 'tpc_child' })).success).toBe(true);
  });

  // A run started through `lh` from a device-denied run (an external bot
  // sender's sandbox) carries no bot sender of its own, only the denial its
  // token passed on: it must not open a sub-topic that would run first-party.
  it('refuses for a run whose own device decision is a denial, without any bot sender', async () => {
    mocks.isOpenedBy.mockResolvedValue(true);
    const denied = runtime({
      deviceAccess: { canUseDevice: false, reason: 'delegated-from-denied-run' },
    });

    expect((await denied.openTopic({ prompt: 'run the deploy script' })).success).toBe(false);
    expect((await denied.sendToTopic({ message: 'hi', topicId: 'tpc_child' })).success).toBe(false);
    expect(mocks.execAgent).not.toHaveBeenCalled();
    expect(mocks.startComposerRun).not.toHaveBeenCalled();
  });

  it("opens one for the bot's owner", async () => {
    const result = await runtime({
      botContext: { ...externalSender.botContext, isOwner: true, senderExternalUserId: 'owner' },
    }).openTopic({ prompt: 'x' });

    expect(result.success).toBe(true);
  });

  it('refuses to open one with Better Coding Experience off', async () => {
    mocks.labOn.mockResolvedValueOnce(false);

    const result = await runtime().openTopic({ prompt: 'x' });

    expect(result.success).toBe(false);
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });
});

describe('lobe-topic server runtime — scoping and delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockImplementation(async (id: string) => ({
      agentId: 'agt_lobe',
      id,
      metadata: {},
    }));
    mocks.isOpenedBy.mockResolvedValue(true);
    mocks.execAgent.mockResolvedValue({ operationId: 'op_c', success: true, topicId: 'tpc_new' });
  });

  it('lists only the sub-topics whose agent the caller may view', async () => {
    const rows = [
      { agentId: 'agt_lobe', id: 'tpc_a', title: 'A' },
      { agentId: 'agt_private', id: 'tpc_b', title: 'B' },
    ];
    mocks.listOpenedTopics.mockResolvedValue(rows);
    mocks.onlyViewable.mockResolvedValue([rows[0]]);

    const result = await runtime().listTopics({});

    expect(mocks.onlyViewable).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      rows,
    );
    expect(result.content).toContain('tpc_a');
    expect(result.content).not.toContain('tpc_b');
  });

  it('opens one with the agent running the call when none is named', async () => {
    // Under `callAgent` the running agent is not the topic's own agent.
    await runtime({ agentId: 'agt_delegate' }).openTopic({ prompt: 'x' });

    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_delegate' }),
    );
  });

  it('refuses a linked sub-topic of a group conversation, which would never report back', async () => {
    mocks.findById.mockResolvedValue({ agentId: 'agt_lobe', groupId: 'grp_1', id: 'tpc_parent' });

    const linked = await runtime().openTopic({ agentId: 'agt_lobe', prompt: 'x' });
    expect(linked.success).toBe(false);
    expect(mocks.execAgent).not.toHaveBeenCalled();

    const detached = await runtime().openTopic({ agentId: 'agt_lobe', detach: true, prompt: 'x' });
    expect(detached.success).toBe(true);
  });

  it('starts an idle sub-topic without reading the queue first, so it works without Redis', async () => {
    mocks.queueAppend.mockResolvedValue({ queued: false, reason: 'idle' });
    mocks.startComposerRun.mockResolvedValue({ success: true });

    const result = await runtime().sendToTopic({ message: 'next', topicId: 'tpc_child' });

    expect(result.success).toBe(true);
    expect(mocks.queueAppend.mock.calls[0][0]).not.toHaveProperty('id');
    expect(mocks.startComposerRun).toHaveBeenCalledTimes(1);
  });

  it('says so when a running sub-topic cannot take a queued message', async () => {
    mocks.queueAppend.mockRejectedValue(
      Object.assign(new Error('Queue unavailable'), { code: 'SERVICE_UNAVAILABLE' }),
    );

    const result = await runtime().sendToTopic({ message: 'next', topicId: 'tpc_child' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('running a turn');
    // The outcome is unknown, not a failure: no unconditional "try again".
    expect(result.content).toMatch(/could not confirm/);
    expect(result.content).toMatch(/Do not resend it blindly/);
    expect(mocks.startComposerRun).not.toHaveBeenCalled();
  });
});

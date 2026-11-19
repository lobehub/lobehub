// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detachFromParent, retireChildTopics } from './childTopics';

const mocks = vi.hoisted(() => ({
  archiveUpdate: vi.fn(),
  assertCreator: vi.fn(),
  assertUse: vi.fn(),
  findOwnLiveRuns: vi.fn(),
  findTopicsRunByOthers: vi.fn(),
  interruptTask: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { interruptTask: mocks.interruptTask };
  }),
}));
vi.mock('@/server/services/aiAgent/steerQueue/liveRuns', () => ({
  findOwnLiveRuns: mocks.findOwnLiveRuns,
  findTopicsRunByOthers: mocks.findTopicsRunByOthers,
}));
vi.mock('@/server/services/topicArchive', () => ({
  TopicArchiveService: vi.fn(function () {
    return { updateTopic: mocks.archiveUpdate };
  }),
}));
vi.mock('../_helpers/conversationResourceGuard', () => ({
  assertCanUseTopicTargets: mocks.assertUse,
  assertCanViewConversationTargets: vi.fn(),
}));
vi.mock('../_helpers/shareVisitorTargetGuard', () => ({
  assertCreatorTopicTargets: mocks.assertCreator,
}));

const item = (id: string, parent: string, trigger: null | string = null) =>
  ({ agentId: 'agt', id, openedBy: { topicId: parent }, trigger }) as any;

const createCtx = () => {
  const topicModel = {
    detachOpenedTopics: vi.fn(),
    findById: vi.fn(async (id: string) => ({ id, trigger: id === 'tpc_run' ? 'task' : null })),
    findOwnTopicById: vi.fn(async (id: string) => ({ id, userId: 'user-1' })),
    listOpenedDescendants: vi.fn(async () => [
      item('tpc_child', 'tpc_parent'),
      item('tpc_run', 'tpc_parent', 'task'),
      item('tpc_under_run', 'tpc_run'),
      item('tpc_grand', 'tpc_child'),
    ]),
    listOpenedTopics: vi.fn(async () => [item('tpc_child', 'tpc_parent')]),
  };
  const trashService = { trashTopics: vi.fn() };
  return {
    ctx: {
      serverDB: {} as any,
      topicModel: topicModel as any,
      trashService: trashService as any,
      userId: 'user-1',
    },
    topicModel,
    trashService,
  };
};

describe('retireChildTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTopicsRunByOthers.mockResolvedValue([]);
    mocks.findOwnLiveRuns.mockImplementation(async (_ctx: unknown, scope: { topicId: string }) =>
      scope.topicId === 'tpc_child' ? ['op_child'] : [],
    );
    mocks.interruptTask.mockResolvedValue({ success: true });
  });

  it('checks every topic, stops running ones, then archives them deepest first — task runs stay', async () => {
    const { ctx } = createCtx();

    await retireChildTopics(ctx, { action: 'archive', mode: 'all', topicId: 'tpc_parent' });

    expect(mocks.assertUse).toHaveBeenCalledWith(expect.anything(), ['tpc_child', 'tpc_grand']);
    expect(mocks.interruptTask).toHaveBeenCalledWith({
      operationId: 'op_child',
      topicId: 'tpc_child',
    });
    expect(mocks.archiveUpdate.mock.calls.map(([id]) => id)).toEqual(['tpc_grand', 'tpc_child']);
    expect(mocks.interruptTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.archiveUpdate.mock.invocationCallOrder[0],
    );
  });

  it('trashes them with the attachment choice', async () => {
    const { ctx, trashService } = createCtx();

    await retireChildTopics(ctx, {
      action: 'trash',
      mode: 'all',
      removeFiles: false,
      topicId: 'tpc_parent',
    });

    expect(trashService.trashTopics).toHaveBeenCalledWith(['tpc_grand'], { removeFiles: false });
    expect(trashService.trashTopics).toHaveBeenCalledWith(['tpc_child'], { removeFiles: false });
  });

  it('changes nothing when a check refuses', async () => {
    const { ctx } = createCtx();
    mocks.assertUse.mockRejectedValueOnce(new Error('FORBIDDEN'));

    await expect(
      retireChildTopics(ctx, { action: 'archive', mode: 'all', topicId: 'tpc_parent' }),
    ).rejects.toThrow('FORBIDDEN');
    expect(mocks.interruptTask).not.toHaveBeenCalled();
    expect(mocks.archiveUpdate).not.toHaveBeenCalled();
  });

  it('refuses over a sub-topic another member is running', async () => {
    const { ctx } = createCtx();
    mocks.findTopicsRunByOthers.mockResolvedValue(['tpc_grand']);

    await expect(
      retireChildTopics(ctx, { action: 'archive', mode: 'all', topicId: 'tpc_parent' }),
    ).rejects.toThrow(/being run by another member/);
    expect(mocks.interruptTask).not.toHaveBeenCalled();
  });

  it('retires nothing when a stop cannot be confirmed', async () => {
    const { ctx } = createCtx();
    mocks.interruptTask.mockResolvedValue({ success: false });

    await expect(
      retireChildTopics(ctx, { action: 'archive', mode: 'all', topicId: 'tpc_parent' }),
    ).rejects.toThrow(/could not be confirmed stopped/);
    expect(mocks.archiveUpdate).not.toHaveBeenCalled();
  });

  it('moves the direct sub-topics up with "detach", once the caller may edit them', async () => {
    const { ctx, topicModel } = createCtx();

    await retireChildTopics(ctx, { action: 'archive', mode: 'detach', topicId: 'tpc_parent' });

    expect(mocks.assertUse).toHaveBeenCalledWith(expect.anything(), ['tpc_child']);
    expect(topicModel.detachOpenedTopics).toHaveBeenCalledWith(['tpc_child']);
    expect(mocks.archiveUpdate).not.toHaveBeenCalled();
  });
});

describe('detachFromParent', () => {
  it('moves a sub-topic up, but leaves a task run with its task', async () => {
    const { ctx, topicModel } = createCtx();

    await detachFromParent(ctx, 'tpc_child');
    expect(topicModel.detachOpenedTopics).toHaveBeenCalledWith(['tpc_child']);

    await expect(detachFromParent(ctx, 'tpc_run')).rejects.toThrow(/belongs to its task/);
  });
});

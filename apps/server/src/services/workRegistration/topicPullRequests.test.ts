import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  linkPushedPullRequests,
  listTopicPullRequestsWithStatus,
  listTopicsPullRequestsWithStatus,
} from './topicPullRequests';

const { listByIdentities, listOpenByHeadRefs } = vi.hoisted(() => ({
  listByIdentities: vi.fn(),
  listOpenByHeadRefs: vi.fn(),
}));

vi.mock('@/database/models/scm', () => ({
  ScmChangeRequestModel: { listByIdentities, listOpenByHeadRefs },
}));

const db = {} as any;
const topicModelWith = (pullRequests?: unknown, visibleTopics: Record<string, unknown>[] = []) => {
  const topics = [{ id: 't1', metadata: pullRequests ? { pullRequests } : {} }, ...visibleTopics];
  return {
    findByIds: vi.fn(async (ids: string[]) =>
      topics.filter((topic) => ids.includes(topic.id as string)),
    ),
  } as any;
};

/** A Work model whose `byTopic` map lists each topic's PR Work rows. */
const workModelWith = (byTopic: Record<string, unknown[]>) =>
  ({
    listTopicsPullRequests: vi.fn(
      async (ids: string[]) =>
        new Map(ids.flatMap((id) => (byTopic[id] ? [[id, byTopic[id]] as const] : []))),
    ),
  }) as any;

const workItem = (number: number, repoFullName = 'lobehub/lobehub') => ({
  identifier: `${repoFullName}#${number}`,
  linkedAt: new Date('2026-11-17T00:00:00Z'),
  number,
  repoFullName,
  source: 'created',
  status: 'open',
  title: `PR ${number}`,
  url: `https://github.com/${repoFullName}/pull/${number}`,
  workId: `wk-${number}`,
});

describe('listTopicPullRequestsWithStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches the GitHub App state where a row is visible, null elsewhere', async () => {
    const workModel = workModelWith({ t1: [workItem(1), workItem(2)] });
    const updatedAt = new Date('2026-11-17T01:00:00Z');
    listByIdentities.mockResolvedValue([
      {
        ciStatus: 'failure',
        id: 'scr-1',
        isDraft: false,
        mergedAt: null,
        metadata: {},
        number: 1,
        repoFullName: 'LobeHub/LobeHub',
        reviewDecision: 'approved',
        state: 'open',
        title: 'From the App',
        topicId: 't1',
        updatedAt,
        wakeCount: 1,
      },
    ]);

    const items = await listTopicPullRequestsWithStatus({
      db,
      topicId: 't1',
      topicModel: topicModelWith(),
      userId: 'u1',
      workModel,
      workspaceId: 'ws1',
    });

    expect(listByIdentities).toHaveBeenCalledWith(db, { userId: 'u1', workspaceId: 'ws1' }, [
      { number: 1, repoFullName: 'lobehub/lobehub' },
      { number: 2, repoFullName: 'lobehub/lobehub' },
    ]);
    expect(items[0].scm).toEqual({
      autoFix: {
        changeRequestId: 'scr-1',
        enabled: true,
        maxWakes: 3,
        ownerTopic: null,
        ownerTopicId: 't1',
        wakeCount: 1,
      },
      ciStatus: 'failure',
      isDraft: false,
      mergedAt: null,
      reviewDecision: 'approved',
      state: 'open',
      title: 'From the App',
      updatedAt,
    });
    expect(items[1].scm).toBeNull();
    expect(items.every((item) => item.vouched)).toBe(true);
  });

  it('reports Auto-fix off and names the other conversation it wakes, when visible', async () => {
    const workModel = workModelWith({ t1: [workItem(1), workItem(2), workItem(3)] });
    const row = (number: number, extra: Record<string, unknown>) => ({
      id: `scr-${number}`,
      isDraft: false,
      metadata: {},
      number,
      repoFullName: 'lobehub/lobehub',
      state: 'open',
      topicId: null,
      updatedAt: new Date(),
      wakeCount: 0,
      ...extra,
    });
    listByIdentities.mockResolvedValue([
      row(1, { metadata: { autoFix: false }, topicId: 'other' }),
      row(2, { topicId: 'hidden' }),
      row(3, {}),
    ]);
    const topicModel = topicModelWith(undefined, [
      { agentId: 'agt-2', id: 'other', title: 'Other conversation' },
    ]);

    const items = await listTopicPullRequestsWithStatus({
      db,
      topicId: 't1',
      topicModel,
      userId: 'u1',
      workModel,
    });

    expect(topicModel.findByIds).toHaveBeenLastCalledWith(['other', 'hidden']);
    expect(items.map((item) => item.scm?.autoFix)).toEqual([
      {
        changeRequestId: 'scr-1',
        enabled: false,
        maxWakes: 3,
        ownerTopic: { agentId: 'agt-2', id: 'other', title: 'Other conversation' },
        ownerTopicId: 'other',
        wakeCount: 0,
      },
      // Woken elsewhere, but not a conversation this viewer can open.
      expect.objectContaining({ enabled: true, ownerTopic: null, ownerTopicId: 'hidden' }),
      // Tracked, but no conversation to wake.
      expect.objectContaining({ ownerTopic: null, ownerTopicId: null }),
    ]);
  });

  it('adds the topic links, hides removed PRs, and keeps the latest link first', async () => {
    listByIdentities.mockResolvedValue([]);
    const workModel = workModelWith({ t1: [workItem(1), workItem(2)] });
    const topicModel = topicModelWith({
      dismissed: ['LobeHub/lobehub#2'],
      links: [
        {
          headRefName: 'feat/own',
          identifier: 'lobehub/lobehub#7',
          linkedAt: '2026-11-18T00:00:00Z',
          source: 'branch',
          url: 'https://github.com/lobehub/lobehub/pull/7',
          vouched: false,
        },
        // Already a Work row: the Work wins.
        {
          identifier: 'lobehub/lobehub#1',
          linkedAt: '2026-11-19T00:00:00Z',
          source: 'manual',
          url: 'https://github.com/lobehub/lobehub/pull/1',
          vouched: true,
        },
      ],
    });

    const items = await listTopicPullRequestsWithStatus({
      db,
      topicId: 't1',
      topicModel,
      userId: 'u1',
      workModel,
    });

    expect(items.map((item) => [item.identifier, item.source, item.vouched])).toEqual([
      ['lobehub/lobehub#7', 'branch', false],
      ['lobehub/lobehub#1', 'created', true],
    ]);
    expect(items[0]).toMatchObject({ headBranch: 'feat/own', workId: null });
  });

  it('skips the scm lookup for a topic without pull requests', async () => {
    const workModel = workModelWith({});

    expect(
      await listTopicPullRequestsWithStatus({
        db,
        topicId: 't1',
        topicModel: topicModelWith(),
        userId: 'u1',
        workModel,
      }),
    ).toEqual([]);
    expect(listByIdentities).not.toHaveBeenCalled();
  });
});

describe('listTopicsPullRequestsWithStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads many topics with one scm lookup and leaves out topics the viewer cannot see', async () => {
    listByIdentities.mockResolvedValue([
      {
        id: 'scr-1',
        isDraft: false,
        mergedAt: new Date('2026-11-18T00:00:00Z'),
        metadata: {},
        number: 1,
        repoFullName: 'lobehub/lobehub',
        state: 'merged',
        topicId: 't2',
        updatedAt: new Date(),
        wakeCount: 0,
      },
    ]);
    const topicModel = topicModelWith(undefined, [
      { agentId: 'agt-1', id: 't2', metadata: {}, title: 'Second' },
    ]);
    const workModel = workModelWith({
      hidden: [workItem(9)],
      t1: [workItem(1)],
      t2: [workItem(1), workItem(2)],
    });

    const byTopic = await listTopicsPullRequestsWithStatus({
      db,
      topicIds: ['t1', 't2', 'hidden', 't1'],
      topicModel,
      userId: 'u1',
      workModel,
    });

    expect(workModel.listTopicsPullRequests).toHaveBeenCalledWith(['t1', 't2']);
    expect([...byTopic.keys()]).toEqual(['t1', 't2']);
    expect(listByIdentities).toHaveBeenCalledTimes(1);
    expect(listByIdentities.mock.calls[0][2]).toEqual([
      { number: 1, repoFullName: 'lobehub/lobehub' },
      { number: 2, repoFullName: 'lobehub/lobehub' },
    ]);
    // The owner conversation is in the batch already: named without another read.
    expect(topicModel.findByIds).toHaveBeenCalledTimes(1);
    expect(byTopic.get('t1')?.[0].scm).toMatchObject({
      autoFix: { ownerTopic: { agentId: 'agt-1', id: 't2', title: 'Second' } },
      state: 'merged',
    });
    expect(byTopic.get('t2')?.map((item) => item.scm?.autoFix.ownerTopic ?? null)).toEqual([
      null,
      null,
    ]);
    expect(byTopic.get('t2')?.[1].scm).toBeNull();
  });

  it('reads nothing for an empty list', async () => {
    const topicModel = topicModelWith();
    expect(
      (
        await listTopicsPullRequestsWithStatus({
          db,
          topicIds: [],
          topicModel,
          userId: 'u1',
          workModel: workModelWith({}),
        })
      ).size,
    ).toBe(0);
    expect(topicModel.findByIds).not.toHaveBeenCalled();
  });
});

describe('linkPushedPullRequests', () => {
  const pushRow = {
    apiName: 'Bash',
    arguments: JSON.stringify({ command: 'git push origin HEAD' }),
    content: 'To github.com:lobehub/lobehub.git\n   031bf96..f6b1c2a  local -> feat/x',
    id: 'msg-push',
    identifier: 'claude-code',
    toolCallId: 'toolu_1',
  };

  const createModels = (row: Record<string, unknown> | null = pushRow) => ({
    messageModel: {
      findToolMessageIdByToolCallId: vi.fn(async () => (row ? row.id : null)),
      listMessagePluginsByIds: vi.fn(async () => (row ? [row] : [])),
    } as any,
    workModel: { registerExternal: vi.fn(async () => ({ id: 'wk' })) } as any,
  });

  const devicePR = {
    headRefName: 'feat/x',
    isDraft: false,
    number: 12,
    state: 'OPEN',
    title: 'Feat X',
    url: 'https://github.com/lobehub/lobehub/pull/12',
  };

  const link = (models: ReturnType<typeof createModels>, devicePullRequests = [devicePR]) =>
    linkPushedPullRequests({
      db,
      devicePullRequests,
      toolCallId: 'toolu_1',
      topicId: 't1',
      userId: 'u1',
      ...models,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    listOpenByHeadRefs.mockResolvedValue([]);
  });

  it('prefers the GitHub App rows for the pushed branch', async () => {
    listOpenByHeadRefs.mockResolvedValue([
      {
        headRef: 'feat/x',
        number: 30,
        repoFullName: 'lobehub/lobehub',
        title: 'Tracked',
        url: 'https://github.com/lobehub/lobehub/pull/30',
      },
    ]);
    const models = createModels();

    expect(await link(models)).toEqual({ linked: ['lobehub/lobehub#30'], status: 'linked' });
    expect(listOpenByHeadRefs).toHaveBeenCalledWith(
      db,
      { userId: 'u1', workspaceId: null },
      'lobehub/lobehub',
      ['feat/x'],
    );
  });

  it('accepts the device answer only for the pushed repository and branch', async () => {
    const models = createModels();

    const result = await link(models, [
      devicePR,
      { ...devicePR, number: 13, url: 'https://github.com/someone/else/pull/13' },
      {
        ...devicePR,
        headRefName: 'main',
        number: 14,
        url: 'https://github.com/lobehub/lobehub/pull/14',
      },
      { ...devicePR, number: 15, url: 'https://github.com/lobehub/lobehub/pull/99' },
    ]);

    expect(result).toEqual({ linked: ['lobehub/lobehub#12'], status: 'linked' });
    expect(models.workModel.registerExternal).toHaveBeenCalledTimes(1);
    expect(models.workModel.registerExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'updated',
        messageId: 'msg-push',
        metadata: { headBranch: 'feat/x', pullRequestLink: 'push' },
        patchFields: ['identifier', 'url', 'title', 'status'],
        resourceId: 'lobehub/lobehub#12',
        status: 'open',
        toolCallId: 'toolu_1#push-link',
        toolIdentifier: 'claude-code',
        toolName: 'Bash',
        topicId: 't1',
      }),
    );
  });

  it('accepts a fork PR whose head repository is the push destination', async () => {
    const models = createModels({
      ...pushRow,
      content: 'To github.com:contributor/lobehub.git\n   031bf96..f6b1c2a  local -> feat/x',
    });

    const result = await link(models, [
      { ...devicePR, headRepoFullName: 'contributor/lobehub' },
      // A same-named branch in a stranger's fork was not this push.
      {
        ...devicePR,
        headRepoFullName: 'stranger/lobehub',
        number: 13,
        url: 'https://github.com/lobehub/lobehub/pull/13',
      },
    ]);

    expect(result).toEqual({ linked: ['lobehub/lobehub#12'], status: 'linked' });
  });

  it('asks the client to retry while the push is not persisted yet', async () => {
    expect(await link(createModels(null))).toEqual({ status: 'pending' });
    expect(await link(createModels({ ...pushRow, content: '' }))).toEqual({ status: 'pending' });
  });

  it('refuses a call that was not a push', async () => {
    const models = createModels({
      ...pushRow,
      arguments: JSON.stringify({ command: 'gh pr view 12' }),
      content: 'title: Feat X',
    });

    expect(await link(models)).toEqual({ status: 'skipped' });
    expect(models.workModel.registerExternal).not.toHaveBeenCalled();
  });
});

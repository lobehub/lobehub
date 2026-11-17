import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linkPushedPullRequests, listTopicPullRequestsWithStatus } from './topicPullRequests';

const { getUserPreference, listByIdentities, listOpenByHeadRefs } = vi.hoisted(() => ({
  getUserPreference: vi.fn(),
  listByIdentities: vi.fn(),
  listOpenByHeadRefs: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserPreference };
  }),
}));

vi.mock('@/database/models/scm', () => ({
  ScmChangeRequestModel: { listByIdentities, listOpenByHeadRefs },
}));

const db = {} as any;

const workItem = (number: number, repoFullName = 'lobehub/lobehub') => ({
  identifier: `${repoFullName}#${number}`,
  linkedAt: new Date('2026-11-17T00:00:00Z'),
  number,
  repoFullName,
  status: 'open',
  title: `PR ${number}`,
  url: `https://github.com/${repoFullName}/pull/${number}`,
  workId: `wk-${number}`,
});

describe('listTopicPullRequestsWithStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches the GitHub App state where a row is visible, null elsewhere', async () => {
    const workModel = {
      listTopicPullRequests: vi.fn(async () => [workItem(1), workItem(2)]),
    } as any;
    const updatedAt = new Date('2026-11-17T01:00:00Z');
    listByIdentities.mockResolvedValue([
      {
        ciStatus: 'failure',
        isDraft: false,
        mergedAt: null,
        number: 1,
        repoFullName: 'LobeHub/LobeHub',
        reviewDecision: 'approved',
        state: 'open',
        title: 'From the App',
        updatedAt,
      },
    ]);

    const items = await listTopicPullRequestsWithStatus({
      db,
      topicId: 't1',
      userId: 'u1',
      workModel,
      workspaceId: 'ws1',
    });

    expect(listByIdentities).toHaveBeenCalledWith(db, { userId: 'u1', workspaceId: 'ws1' }, [
      { number: 1, repoFullName: 'lobehub/lobehub' },
      { number: 2, repoFullName: 'lobehub/lobehub' },
    ]);
    expect(items[0].scm).toEqual({
      ciStatus: 'failure',
      isDraft: false,
      mergedAt: null,
      reviewDecision: 'approved',
      state: 'open',
      title: 'From the App',
      updatedAt,
    });
    expect(items[1].scm).toBeNull();
  });

  it('skips the scm lookup for a topic without pull requests', async () => {
    const workModel = { listTopicPullRequests: vi.fn(async () => []) } as any;

    expect(
      await listTopicPullRequestsWithStatus({ db, topicId: 't1', userId: 'u1', workModel }),
    ).toEqual([]);
    expect(listByIdentities).not.toHaveBeenCalled();
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
    getUserPreference.mockResolvedValue({ lab: { enableBetterCodingExperience: true } });
    listOpenByHeadRefs.mockResolvedValue([]);
  });

  it('does nothing while the lab is off', async () => {
    getUserPreference.mockResolvedValue({ lab: {} });
    const models = createModels();

    expect(await link(models)).toEqual({ status: 'skipped' });
    expect(models.messageModel.findToolMessageIdByToolCallId).not.toHaveBeenCalled();
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
        metadata: { headBranch: 'feat/x' },
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

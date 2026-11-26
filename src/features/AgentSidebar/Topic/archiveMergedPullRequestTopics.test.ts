import { toast } from '@lobehub/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { workService } from '@/services/work';
import { type ChatTopic } from '@/types/topic';

import {
  archiveMergedPullRequestTopics,
  findMergedPullRequestTopics,
} from './archiveMergedPullRequestTopics';

const { chatState, gitReviewState } = vi.hoisted(() => ({
  chatState: { refreshTopic: vi.fn(), updateTopicStatus: vi.fn() },
  gitReviewState: { gitPullRequestDetailMap: {} as Record<string, unknown> },
}));

vi.mock('@/services/work', () => ({ workService: { listTopicsPullRequests: vi.fn() } }));
vi.mock('@/store/chat', () => ({ useChatStore: { getState: () => chatState } }));
vi.mock('@/store/device/gitReview/store', () => ({
  useGitReviewStore: { getState: () => gitReviewState },
}));

const topic = (id: string) => ({ createdAt: 0, id, title: id, updatedAt: 0 }) as ChatTopic;

const mergedPr = (number: number) => ({
  identifier: `lobehub/lobehub#${number}`,
  linkedAt: new Date('2026-11-20T00:00:00Z'),
  number,
  repoFullName: 'lobehub/lobehub',
  scm: null,
  source: 'created' as const,
  status: 'merged',
  title: null,
  url: null,
  vouched: true,
  workId: `work-${number}`,
});

const t = ((key: string) => key) as any;

describe('findMergedPullRequestTopics', () => {
  afterEach(() => vi.mocked(workService.listTopicsPullRequests).mockReset());

  it('asks the server in batches of 100 topics', async () => {
    const topics = Array.from({ length: 205 }, (_, i) => topic(`t${i}`));
    const list = vi
      .spyOn(workService, 'listTopicsPullRequests')
      .mockImplementation(async (ids) => (ids.includes('t150') ? { t150: [mergedPr(1)] } : {}));

    const merged = await findMergedPullRequestTopics(topics);

    expect(list.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 5]);
    expect(merged.map((item) => item.id)).toEqual(['t150']);
  });

  it('asks nothing when no topic is left to archive', async () => {
    const list = vi.spyOn(workService, 'listTopicsPullRequests');

    expect(await findMergedPullRequestTopics([topic('a')], null)).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('uses the device reads this client holds', async () => {
    vi.spyOn(workService, 'listTopicsPullRequests').mockResolvedValue({
      t: [{ ...mergedPr(9), status: 'open' }],
    });
    gitReviewState.gitPullRequestDetailMap = {
      'device:/repo:9': {
        value: {
          detail: {
            number: 9,
            repo: { name: 'lobehub', owner: 'lobehub' },
            state: 'merged',
            title: 'Merged on GitHub',
            url: 'https://github.com/lobehub/lobehub/pull/9',
          } as any,
          status: 'ok',
        } as any,
      },
    };

    expect((await findMergedPullRequestTopics([topic('t')])).map((item) => item.id)).toEqual(['t']);
    gitReviewState.gitPullRequestDetailMap = {};
  });
  it('keeps a merge the server knows of when this client holds an older open read', async () => {
    vi.mocked(workService.listTopicsPullRequests).mockResolvedValue({ t: [mergedPr(10)] });
    gitReviewState.gitPullRequestDetailMap = {
      'device:/repo:10': {
        value: {
          detail: {
            number: 10,
            repo: { name: 'lobehub', owner: 'lobehub' },
            state: 'open',
            title: 'Read before the merge',
            url: 'https://github.com/lobehub/lobehub/pull/10',
          } as any,
          status: 'ok',
        } as any,
      },
    };

    expect((await findMergedPullRequestTopics([topic('t')])).map((item) => item.id)).toEqual(['t']);
    gitReviewState.gitPullRequestDetailMap = {};
  });
});

describe('archiveMergedPullRequestTopics', () => {
  const { refreshTopic, updateTopicStatus } = chatState;

  beforeEach(() => {
    vi.spyOn(toast, 'error').mockImplementation(() => undefined as any);
    vi.spyOn(toast, 'info').mockImplementation(() => undefined as any);
    vi.spyOn(toast, 'success').mockImplementation(() => undefined as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(workService.listTopicsPullRequests).mockReset();
    updateTopicStatus.mockReset();
    refreshTopic.mockReset();
  });

  it('completes the merged topics and reports how many', async () => {
    vi.spyOn(workService, 'listTopicsPullRequests').mockResolvedValue({ a: [mergedPr(1)] });

    await archiveMergedPullRequestTopics({ t, topics: [topic('a'), topic('b')] });

    expect(updateTopicStatus).toHaveBeenCalledExactlyOnceWith({
      status: 'completed',
      topicId: 'a',
    });
    expect(refreshTopic).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('actions.archiveMergedPullRequestsSuccess');
  });

  it('says so when no topic has a merged PR', async () => {
    vi.spyOn(workService, 'listTopicsPullRequests').mockResolvedValue({});

    await archiveMergedPullRequestTopics({ t, topics: [topic('a')] });

    expect(updateTopicStatus).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('actions.archiveMergedPullRequestsNone');
  });

  it('archives nothing and reports the failure when the server read fails', async () => {
    vi.spyOn(workService, 'listTopicsPullRequests').mockRejectedValue(new Error('offline'));

    await archiveMergedPullRequestTopics({ t, topics: [topic('a')] });

    expect(updateTopicStatus).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('actions.archiveMergedPullRequestsFailed');
  });
});

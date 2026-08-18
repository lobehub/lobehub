// @vitest-environment node
import { ConnectorDataError } from '@lobechat/connector-data';
import type { TwitterPost, TwitterProfile } from '@lobechat/connector-data/twitter';
import { describe, expect, it, vi } from 'vitest';

import { createTwitterTaskRecommendationProvider } from './twitter';

const profile: TwitterProfile = {
  id: '42',
  metrics: {},
  name: 'Ada',
  sourceUrl: 'https://x.com/ada',
  username: 'ada',
};
const authoredPost: TwitterPost = {
  authorId: '42',
  authorUsername: 'ada',
  id: '100',
  metrics: { replyCount: 2 },
  referencedPostTypes: [],
  sourceUrl: 'https://x.com/ada/status/100',
  text: 'We shipped the new connector.',
};
const mention: TwitterPost = {
  authorId: '7',
  authorUsername: 'reader',
  id: '101',
  metrics: {},
  referencedPostTypes: [],
  sourceUrl: 'https://x.com/reader/status/101',
  text: '@ada Could you share an example?',
};

/** @example X recommendations stay read-only and grounded in exact public post URLs. */
describe('createTwitterTaskRecommendationProvider', () => {
  /** @example Recent authored posts and mentions become distinct trusted task signals. */
  it('collects recent activity with titled X sources', async () => {
    const searchRecentPosts = vi
      .fn()
      .mockResolvedValueOnce([authoredPost])
      .mockResolvedValueOnce([mention]);
    const provider = createTwitterTaskRecommendationProvider();
    const result = await provider.collect({
      connectorData: {
        getTwitterClient: vi.fn(async () => ({
          getProfile: vi.fn(async () => profile),
          searchRecentPosts,
        })),
      },
    } as never);

    expect(result).toMatchObject({
      diagnostics: { evidenceCount: 2, failedCount: 0, succeededCount: 3 },
      signalCount: 2,
      sources: [
        {
          title: 'We shipped the new connector.',
          type: 'twitter',
          url: 'https://x.com/ada/status/100',
        },
        {
          title: '@ada Could you share an example?',
          type: 'twitter',
          url: 'https://x.com/reader/status/101',
        },
      ],
    });
    expect(result.context).toContain('"kind": "authored_post"');
    expect(result.context).toContain('"kind": "mention"');
    expect(provider.guide.principles.join('\n')).toContain('Never post, reply, like, repost');
  });

  /** @example A failed mention query remains partial while authored-post tasks stay available. */
  it('retains successful signals when one recent search fails', async () => {
    const searchRecentPosts = vi
      .fn()
      .mockResolvedValueOnce([authoredPost])
      .mockRejectedValueOnce(
        new ConnectorDataError({
          code: 'twitter_search_failed',
          operation: 'searchRecentPosts',
          provider: 'twitter',
          retryable: true,
        }),
      );
    const provider = createTwitterTaskRecommendationProvider();
    const result = await provider.collect({
      connectorData: {
        getTwitterClient: vi.fn(async () => ({
          getProfile: vi.fn(async () => profile),
          searchRecentPosts,
        })),
      },
    } as never);

    expect(result).toMatchObject({
      diagnostics: {
        errors: [{ operation: 'mention', retryable: true }],
        evidenceCount: 1,
        failedCount: 1,
      },
      signalCount: 1,
    });
  });
});

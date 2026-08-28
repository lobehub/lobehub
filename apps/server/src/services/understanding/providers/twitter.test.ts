import { ConnectorDataError } from '@lobechat/connector-data';
import type { TwitterPost, TwitterProfile } from '@lobechat/connector-data/twitter';
import { describe, expect, it, vi } from 'vitest';

import { twitterUnderstandingProvider } from './twitter';

const profile: TwitterProfile = {
  description: 'Building developer tools',
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
  metrics: { likeCount: 3 },
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

/** @example X public evidence enriches Understanding while preserving authorship boundaries. */
describe('twitterUnderstandingProvider', () => {
  /** @example A pinned recent post is counted once while third-party mentions remain distinct. */
  it('collects profile, authored posts, and mentions without duplicating the pinned post', async () => {
    const searchRecentPosts = vi
      .fn()
      .mockResolvedValueOnce([authoredPost])
      .mockResolvedValueOnce([mention]);
    const result = await twitterUnderstandingProvider.collect({
      connectorData: {
        getTwitterClient: vi.fn(async () => ({
          getProfile: vi.fn(async () => ({ ...profile, pinnedPost: authoredPost })),
          searchRecentPosts,
        })),
      } as never,
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      diagnostics: { evidenceCount: 3, failedCount: 0, succeededCount: 3 },
      sourceCount: 3,
    });
    expect(result.context).toContain('We shipped the new connector.');
    expect(result.context).toContain('@ada Could you share an example?');
    expect(result.context).toContain('Mentions, replies, and engagement counts');
    expect(result.context).toContain('latest seven days');
  });

  /** @example One failed recent search remains partial while profile and other activity stay usable. */
  it('retains profile and authored posts when mention search fails', async () => {
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
    const result = await twitterUnderstandingProvider.collect({
      connectorData: {
        getTwitterClient: vi.fn(async () => ({
          getProfile: vi.fn(async () => profile),
          searchRecentPosts,
        })),
      } as never,
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      diagnostics: {
        errors: [{ operation: 'mentions', retryable: true }],
        evidenceCount: 2,
        failedCount: 1,
      },
      sourceCount: 2,
    });
  });
});

import { describe, expect, it } from 'vitest';

import { parseTwitterPosts, parseTwitterProfile } from './parser';

/** @example Market X responses become bounded, source-addressable public evidence. */
describe('X response parsers', () => {
  /** @example Authenticated profile metadata retains a canonical URL and expanded pinned post. */
  it('normalizes a wrapped profile and pinned post', () => {
    expect(
      parseTwitterProfile({
        data: {
          data: {
            created_at: '2020-01-01T00:00:00.000Z',
            description: 'Building useful tools',
            id: '42',
            name: 'Ada',
            pinned_tweet_id: '100',
            public_metrics: { followers_count: 12, tweet_count: 34 },
            username: 'ada',
            verified: true,
          },
          includes: {
            tweets: [
              {
                author_id: '42',
                created_at: '2026-08-01T00:00:00.000Z',
                id: '100',
                text: 'Pinned launch notes',
              },
            ],
            users: [{ id: '42', username: 'ada' }],
          },
        },
      }),
    ).toEqual({
      createdAt: '2020-01-01T00:00:00.000Z',
      description: 'Building useful tools',
      id: '42',
      metrics: { followersCount: 12, postCount: 34 },
      name: 'Ada',
      pinnedPost: {
        authorId: '42',
        authorUsername: 'ada',
        createdAt: '2026-08-01T00:00:00.000Z',
        id: '100',
        metrics: {},
        referencedPostTypes: [],
        sourceUrl: 'https://x.com/ada/status/100',
        text: 'Pinned launch notes',
      },
      sourceUrl: 'https://x.com/ada',
      username: 'ada',
      verified: true,
    });
  });

  /** @example Recent-search posts resolve expanded authors and public engagement counters. */
  it('normalizes wrapped recent-search posts', () => {
    expect(
      parseTwitterPosts(
        {
          data: {
            data: [
              {
                author_id: '7',
                conversation_id: '200',
                created_at: '2026-08-09T12:00:00Z',
                id: '200',
                public_metrics: { like_count: 5, reply_count: 2, retweet_count: 1 },
                referenced_tweets: [{ id: '199', type: 'replied_to' }],
                text: 'Could you share the migration notes?',
              },
            ],
            includes: { users: [{ id: '7', username: 'reader' }] },
          },
        },
        10,
      ),
    ).toEqual([
      {
        authorId: '7',
        authorUsername: 'reader',
        conversationId: '200',
        createdAt: '2026-08-09T12:00:00.000Z',
        id: '200',
        metrics: { likeCount: 5, replyCount: 2, repostCount: 1 },
        referencedPostTypes: ['replied_to'],
        sourceUrl: 'https://x.com/reader/status/200',
        text: 'Could you share the migration notes?',
      },
    ]);
  });

  /** @example X recent-search metadata with zero results becomes valid empty evidence. */
  it('normalizes an explicit zero-result response', () => {
    // ROOT CAUSE:
    //
    // X omits the `data` collection when a recent search has no matching posts and returns only
    // `{ meta: { result_count: 0 } }`. Treating every missing collection as malformed made a
    // successful empty search count as a failed Understanding source operation.
    //
    // Before: parseTwitterPosts({ data: { meta: { result_count: 0 } } }, 10) returned undefined.
    // After: the explicit zero-result metadata is normalized to an empty post collection.
    expect(parseTwitterPosts({ data: { meta: { result_count: 0 } } }, 10)).toEqual([]);
  });

  /** @example A non-empty malformed collection is rejected instead of becoming empty evidence. */
  it('rejects a recent-search collection with no valid posts', () => {
    expect(parseTwitterPosts({ data: { data: [{ unexpected: true }] } }, 10)).toBeUndefined();
  });

  /** @example An invalid handle cannot inject operators into later recent-search queries. */
  it('rejects a profile whose username is not an X handle', () => {
    expect(
      parseTwitterProfile({
        data: { data: { id: '42', name: 'Ada', username: 'ada OR from:someone_else' } },
      }),
    ).toBeUndefined();
  });
});

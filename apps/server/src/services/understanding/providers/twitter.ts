import { getConnectorErrorMessage, isConnectorErrorRetryable } from '@lobechat/connector-data';
import type { TwitterPost } from '@lobechat/connector-data/twitter';

import type { UnderstandingProvider } from '../types';

const MAX_RECENT_POSTS = 25;

interface TwitterActivityCollection {
  errors: Array<{
    code: string;
    message: string;
    operation: string;
    provider: 'twitter';
    retryable: boolean;
  }>;
  mentions: TwitterPost[];
  posts: TwitterPost[];
  succeededCount: number;
}

const collectRecentActivity = async (
  searchRecentPosts: (input: { maxResults?: number; query: string }) => Promise<TwitterPost[]>,
  username: string,
): Promise<TwitterActivityCollection> => {
  const searches = [
    { kind: 'posts', query: `from:${username} -is:retweet` },
    { kind: 'mentions', query: `@${username} -from:${username} -is:retweet` },
  ] as const;
  const settled = await Promise.allSettled(
    searches.map(({ query }) => searchRecentPosts({ maxResults: MAX_RECENT_POSTS, query })),
  );
  const errors = settled.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          {
            code: 'TWITTER_RECENT_ACTIVITY_FAILED',
            message:
              getConnectorErrorMessage(result.reason) ?? 'X recent activity collection failed',
            operation: searches[index].kind,
            provider: 'twitter' as const,
            retryable: isConnectorErrorRetryable(result.reason),
          },
        ]
      : [],
  );
  return {
    errors,
    mentions: settled[1].status === 'fulfilled' ? settled[1].value : [],
    posts: settled[0].status === 'fulfilled' ? settled[0].value : [],
    succeededCount: settled.filter(({ status }) => status === 'fulfilled').length,
  };
};

/**
 * Collects public profile and recent activity evidence for onboarding Understanding.
 *
 * Use when:
 * - A connected X account participates in the onboarding Understanding session
 *
 * Expects:
 * - Connector Data has resolved the current user's read-only Market X connection
 *
 * Returns:
 * - A bounded source brief that separates authored posts from third-party mentions
 */
export const twitterUnderstandingProvider: UnderstandingProvider = {
  connectionSource: 'lobehub',
  id: 'twitter',
  collect: async ({ connectorData }) => {
    const client = await connectorData.getTwitterClient();
    const profile = await client.getProfile();
    const activity = await collectRecentActivity(client.searchRecentPosts, profile.username);
    const posts = [
      ...new Map(
        activity.posts
          .filter(({ id }) => id !== profile.pinnedPost?.id)
          .map((post) => [post.id, post]),
      ).values(),
    ];
    const authoredPostIds = new Set(posts.map(({ id }) => id));
    const mentions = [
      ...new Map(
        activity.mentions
          .filter(({ id }) => !authoredPostIds.has(id))
          .map((post) => [post.id, post]),
      ).values(),
    ];
    const evidenceCount = 1 + posts.length + mentions.length + (profile.pinnedPost ? 1 : 0);

    return {
      context: [
        'Provider: twitter',
        '# Source Brief',
        'X evidence policy:',
        '- The profile bio and authored posts are public self-presentation signals, not proof of a current job, project, or commitment.',
        '- A pinned post may be intentionally persistent and old; do not treat it as recent activity unless its timestamp establishes recency.',
        '- Mentions, replies, and engagement counts indicate public attention, not an obligation to respond or evidence that the user agrees.',
        '- Keep authored posts distinct from third-party mentions and do not infer sensitive traits, private relationships, or off-platform intent.',
        '- Recent search covers only the latest seven days, so missing topics or activity must not be treated as evidence of absence.',
        JSON.stringify({ mentions, posts, profile, provider: 'twitter' }, null, 2),
      ].join('\n\n'),
      diagnostics: {
        errors: activity.errors,
        evidenceCount,
        failedCount: activity.errors.length,
        succeededCount: 1 + activity.succeededCount,
      },
      sourceCount: evidenceCount,
    };
  },
};

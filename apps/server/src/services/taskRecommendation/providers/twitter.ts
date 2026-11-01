import { ConnectorDataError } from '@lobechat/connector-data';
import type { TwitterPost } from '@lobechat/connector-data/twitter';
import { DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG } from '@lobechat/prompts';
import type { OnboardingTaskSource } from '@lobechat/types';

import type { TwitterTaskRecommendationProviderConfig } from '../config';
import type { TaskRecommendationProvider } from '../types';

interface TwitterSignal {
  kind: 'authored_post' | 'mention';
  post: TwitterPost;
}

/**
 * Creates the independent X task recommendation collector.
 *
 * Use when:
 * - The onboarding task workflow needs recent public post and mention signals
 * - Tests or product tuning need to inject a bounded X collection policy
 *
 * Expects:
 * - A read-only X connector available through Connector Data
 * - Prompt guidance that keeps all social side effects behind later user approval
 *
 * Returns:
 * - A registry-ready provider that emits grounded public post URLs and bounded evidence
 */
export const createTwitterTaskRecommendationProvider = (
  config: TwitterTaskRecommendationProviderConfig = {
    ...DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.providers.twitter,
    maxContextLength: 24_000,
    maxSignals: 32,
  },
): TaskRecommendationProvider => ({
  id: 'twitter',
  guide: { examples: config.examples, principles: config.principles },
  collect: async ({ connectorData }) => {
    const client = await connectorData.getTwitterClient();
    const profile = await client.getProfile();
    const searches = [
      {
        kind: 'authored_post',
        query: `from:${profile.username} -is:retweet`,
      },
      {
        kind: 'mention',
        query: `@${profile.username} -from:${profile.username} -is:retweet`,
      },
    ] as const;
    const maxResults = Math.max(10, Math.ceil(config.maxSignals / searches.length));
    const settled = await Promise.allSettled(
      searches.map(({ query }) => client.searchRecentPosts({ maxResults, query })),
    );
    const errors = settled.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              code: 'TWITTER_TASK_SIGNAL_COLLECTION_FAILED',
              message: 'X task signal collection failed',
              operation: searches[index].kind,
              provider: 'twitter',
              retryable:
                result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
            },
          ]
        : [],
    );
    const candidates = settled.flatMap((result, index): TwitterSignal[] =>
      result.status === 'fulfilled'
        ? result.value.map((post) => ({ kind: searches[index].kind, post }))
        : [],
    );
    const signals = [
      ...new Map(candidates.map((signal) => [signal.post.id, signal])).values(),
    ].slice(0, config.maxSignals);
    const sources = [
      ...new Map(
        signals.map(({ post }) => [
          post.sourceUrl,
          {
            title: post.text.replaceAll(/\s+/g, ' ').slice(0, 160),
            type: 'twitter',
            url: post.sourceUrl,
          } satisfies OnboardingTaskSource,
        ]),
      ).values(),
    ];

    return {
      context: JSON.stringify(
        {
          profile: {
            description: profile.description,
            name: profile.name,
            sourceUrl: profile.sourceUrl,
            username: profile.username,
          },
          provider: 'twitter',
          recentSearchWindowDays: 7,
          signals,
        },
        null,
        2,
      ).slice(0, config.maxContextLength),
      diagnostics: {
        errors,
        evidenceCount: signals.length,
        failedCount: errors.length,
        succeededCount: 1 + settled.filter(({ status }) => status === 'fulfilled').length,
      },
      signalCount: signals.length,
      sources,
    };
  },
});

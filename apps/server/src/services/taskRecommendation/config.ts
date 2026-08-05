import type {
  OnboardingTaskRecommendationProviderGuide,
  OnboardingTaskRecommendationWritingGuide,
} from '@lobechat/prompts';
import { DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG } from '@lobechat/prompts';

/** Allocation settings for distributing generated tasks across connected providers. */
export interface TaskRecommendationAllocationConfig {
  /** Maximum recommendations generated for one provider. */
  maxPerProvider: number;
  /** Minimum recommendations generated for every provider with usable evidence. */
  minPerProvider: number;
  /** Approximate total recommendations across the onboarding session. */
  targetTotal: number;
}

/** Provider-specific prompt guidance and examples supplied to the recommendation agent. */
export interface TaskRecommendationProviderConfig extends OnboardingTaskRecommendationProviderGuide {
  /** Maximum serialized connector context supplied to one provider agent call. */
  maxContextLength: number;
}

/** GitHub collection policy for task-oriented repository and contribution signals. */
export interface GitHubTaskRecommendationProviderConfig extends TaskRecommendationProviderConfig {
  /** Maximum GitHub records serialized into one recommendation call. */
  maxSignals: number;
  /** Age after the last push at which an active repository becomes a maintenance candidate. */
  staleAfterDays: number;
}

/** One named Gmail search used to collect a distinct recommendation signal category. */
export interface GmailTaskRecommendationQuery {
  /** Stable category included in diagnostics and the serialized evidence. */
  kind: 'actionable' | 'follow_up_candidate' | 'subscription_cleanup';
  /** Gmail search query executed by the existing connector client. */
  query: string;
}

/** Gmail collection policy for task-oriented message searches. */
export interface GmailTaskRecommendationProviderConfig extends TaskRecommendationProviderConfig {
  /** Maximum deduplicated Gmail records serialized into one recommendation call. */
  maxSignals: number;
  /** Independent Gmail searches run concurrently for this recommendation pass. */
  queries: GmailTaskRecommendationQuery[];
}

/** Complete configurable policy for onboarding task generation. */
export interface TaskRecommendationConfig {
  /** Cross-provider recommendation allocation policy. */
  allocation: TaskRecommendationAllocationConfig;
  /** Provider playbooks keyed by connector identifier. */
  providers: {
    /** GitHub recommendation and collection policy. */
    github: GitHubTaskRecommendationProviderConfig;
    /** Gmail recommendation and collection policy. */
    gmail: GmailTaskRecommendationProviderConfig;
  };
  /** Cross-provider recommendation writing policy. */
  writing: OnboardingTaskRecommendationWritingGuide;
}

/** Default recommendation policy kept in one injectable configuration object. */
export const defaultTaskRecommendationConfig: TaskRecommendationConfig = {
  allocation: {
    maxPerProvider: 6,
    minPerProvider: 2,
    targetTotal: 9,
  },
  providers: {
    github: {
      ...DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.providers.github,
      maxContextLength: 24_000,
      maxSignals: 24,
      staleAfterDays: 120,
    },
    gmail: {
      ...DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.providers.gmail,
      maxContextLength: 24_000,
      maxSignals: 32,
      queries: [
        { kind: 'actionable', query: 'in:inbox newer_than:30d (is:important OR is:starred)' },
        { kind: 'follow_up_candidate', query: 'in:sent older_than:7d newer_than:90d' },
        {
          kind: 'subscription_cleanup',
          query: 'newer_than:180d (category:promotions OR unsubscribe)',
        },
      ],
    },
  },
  writing: DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.writing,
};

/** Computes provider budgets from an injectable recommendation policy. */
export class TaskRecommendationConfigurator {
  private readonly allocation: TaskRecommendationAllocationConfig;
  /** Provider-specific collection and prompt policy keyed by connector. */
  readonly providers: TaskRecommendationConfig['providers'];
  /** Shared title, instruction, and source policy for every provider writer. */
  readonly writing: OnboardingTaskRecommendationWritingGuide;

  constructor(config: TaskRecommendationConfig = defaultTaskRecommendationConfig) {
    this.allocation = config.allocation;
    this.providers = config.providers;
    this.writing = config.writing;
  }

  /**
   * Computes the number of recommendations requested from each connected provider.
   *
   * Use when:
   * - A recommendation workflow has resolved its usable provider count
   * - Product tuning must change totals without a provider-count lookup table
   *
   * Expects:
   * - A positive count of providers participating in this generation
   *
   * Returns:
   * - A rounded fair-share budget clamped to the configured per-provider bounds
   */
  recommendationsPerProvider(providerCount: number): number {
    if (!Number.isInteger(providerCount) || providerCount < 1) return 0;
    const { maxPerProvider, minPerProvider, targetTotal } = this.allocation;
    return Math.min(
      maxPerProvider,
      Math.max(minPerProvider, Math.round(targetTotal / providerCount)),
    );
  }
}

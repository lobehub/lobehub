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

/** Notion collection policy for task-oriented workspace signals. */
export interface NotionTaskRecommendationProviderConfig extends TaskRecommendationProviderConfig {
  /** Maximum pages enriched with Notion-flavored Markdown. */
  maxContentPages: number;
  /** Maximum actionable Notion records serialized into one recommendation call. */
  maxSignals: number;
  /** Age after the last edit at which a page becomes a maintenance review candidate. */
  staleAfterDays: number;
  /**
   * Minimum share of dated visible items that must be stale before coverage-first guidance applies.
   * @default 0.9
   */
  staleItemRatioThreshold: number;
  /** Additional trusted writing policy used when the visible Notion scan is stale-dominant. */
  staleWorkspacePrinciples: readonly string[];
}

/** X collection policy for recent public post and mention signals. */
export interface TwitterTaskRecommendationProviderConfig extends TaskRecommendationProviderConfig {
  /** Maximum deduplicated recent X records serialized into one recommendation call. */
  maxSignals: number;
}

/** Complete configurable policy for onboarding task generation. */
export interface TaskRecommendationConfig {
  /** Cross-provider recommendation allocation policy. */
  allocation: TaskRecommendationAllocationConfig;
  /** Cross-provider recommendation writing policy. */
  writing: OnboardingTaskRecommendationWritingGuide;
}

/** Default recommendation policy kept in one injectable configuration object. */
export const defaultTaskRecommendationConfig: TaskRecommendationConfig = {
  allocation: {
    maxPerProvider: 2,
    minPerProvider: 2,
    targetTotal: 4,
  },
  writing: DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.writing,
};

/** Computes provider budgets from an injectable recommendation policy. */
export class TaskRecommendationConfigurator {
  private readonly allocation: TaskRecommendationAllocationConfig;
  /** Shared title, instruction, and source policy for every provider writer. */
  readonly writing: OnboardingTaskRecommendationWritingGuide;

  constructor(config: TaskRecommendationConfig = defaultTaskRecommendationConfig) {
    this.allocation = config.allocation;
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

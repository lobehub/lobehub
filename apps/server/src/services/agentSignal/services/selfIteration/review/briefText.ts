import {
  formatSelfReviewBriefSummary,
  formatSelfReviewBriefTitle,
  type SelfReviewBriefDetails,
} from '@lobechat/agent-signal/brief';

import home from '@/locales/default/home';

/**
 * Counts of self-review actions grouped by execution status.
 */
export interface SelfReviewBriefTextActionCounts {
  /** Number of actions applied to durable resources. */
  applied: number;
  /** Number of actions that failed after planning or execution. */
  failed: number;
  /** Number of actions left as user-visible proposals. */
  proposed: number;
  /** Number of actions skipped by planner or executor policy. */
  skipped: number;
}

/**
 * User-visible action summaries grouped by brief outcome.
 */
export interface SelfReviewBriefTextActionSummaries {
  /** User-visible summaries for actions applied to durable resources. */
  applied: string[];
  /** User-visible summaries for actions that failed. */
  failed: string[];
  /** User-visible summaries for non-noop proposal actions. */
  proposed: string[];
}

/**
 * Translation function used to render persisted Agent Signal Daily Brief text.
 */
export interface SelfReviewBriefTextTranslator {
  /** Resolves a `home` namespace key with simple string interpolation. */
  (key: string, options?: Record<string, string>): string;
}

/**
 * Input context for deterministic nightly self-review Daily Brief copy.
 */
export interface SelfReviewBriefTextInput {
  /** Per-status action counts computed by the Agent Signal projection service. */
  actionCounts: SelfReviewBriefTextActionCounts;
  /** User-visible action summaries grouped by outcome status. */
  actionSummaries: SelfReviewBriefTextActionSummaries;
  /**
   * Proposal actions or ideas read back from the brief metadata. When present,
   * the title names the main change and the summary describes it instead of
   * the generic count copy.
   */
  details?: SelfReviewBriefDetails;
  /** Coarse outcome selected by the projection service. */
  outcome: 'applied' | 'ideas' | 'proposal';
  /** Locale-aware translator for the `home` namespace. Defaults to English resources. */
  t?: SelfReviewBriefTextTranslator;
}

/**
 * Localized Daily Brief shell text produced by nightly self-review.
 */
export interface SelfReviewBriefText {
  /** Brief priority expected by the Daily Brief model. */
  priority: 'info' | 'normal';
  /** User-visible summary, optionally including action bullets. */
  summary: string;
  /** User-visible Daily Brief title. */
  title: string;
  /** Daily Brief display type. */
  type: 'decision' | 'insight';
}

const defaultTranslate: SelfReviewBriefTextTranslator = (key, options = {}) => {
  const template = home[key as keyof typeof home] ?? key;

  return Object.entries(options).reduce(
    (content, [name, value]) => content.replace(`{{${name}}}`, value),
    template,
  );
};

const actionCountKey = (input: {
  count: number;
  pluralKey: string;
  singularKey: string;
  t: SelfReviewBriefTextTranslator;
}) =>
  input.t(input.count === 1 ? input.singularKey : input.pluralKey, {
    count: String(input.count),
  });

const withDetails = (summary: string, heading: string, details: string[] = []) => {
  const cleanDetails = details.map((detail) => detail.trim()).filter(Boolean);

  return cleanDetails.length > 0
    ? `${summary}\n\n**${heading}**\n${cleanDetails.map((detail) => `- ${detail}`).join('\n')}`
    : summary;
};

/**
 * Builds localized Daily Brief shell text for Agent Signal nightly self-review.
 *
 * Use when:
 * - Nightly self-review projection needs title, summary, type, and priority
 * - The output is user-visible and must be translated before persistence
 *
 * Expects:
 * - `outcome` and `actionCounts` have already been computed by service policy
 * - Action summaries are already user-safe strings from execution/proposal results
 *
 * Returns:
 * - Deterministic brief text without making a model call
 */
export const createSelfReviewBriefText = (input: SelfReviewBriefTextInput): SelfReviewBriefText => {
  const t = input.t ?? defaultTranslate;

  const details = input.details;

  if (input.outcome === 'proposal' && details?.kind === 'proposal') {
    return {
      priority: 'normal',
      summary:
        formatSelfReviewBriefSummary(details, t) ||
        actionCountKey({
          count: input.actionCounts.proposed,
          pluralKey: 'brief.agentSignal.selfReview.proposal.summary_plural',
          singularKey: 'brief.agentSignal.selfReview.proposal.summary',
          t,
        }),
      title: formatSelfReviewBriefTitle(details, t),
      type: 'decision',
    };
  }

  if (input.outcome === 'proposal') {
    const summary = actionCountKey({
      count: input.actionCounts.proposed,
      pluralKey: 'brief.agentSignal.selfReview.proposal.summary_plural',
      singularKey: 'brief.agentSignal.selfReview.proposal.summary',
      t,
    });

    return {
      priority: 'normal',
      summary: withDetails(
        summary,
        t('brief.agentSignal.selfReview.proposal.heading'),
        input.actionSummaries.proposed,
      ),
      title: t('brief.agentSignal.selfReview.proposal.title'),
      type: 'decision',
    };
  }

  if (input.outcome === 'ideas' && details?.kind === 'ideas') {
    return {
      priority: 'info',
      summary:
        formatSelfReviewBriefSummary(details, t) || t('brief.agentSignal.selfReview.ideas.summary'),
      title: formatSelfReviewBriefTitle(details, t),
      type: 'insight',
    };
  }

  if (input.outcome === 'ideas') {
    return {
      priority: 'info',
      summary: t('brief.agentSignal.selfReview.ideas.summary'),
      title: t('brief.agentSignal.selfReview.ideas.title'),
      type: 'insight',
    };
  }

  const summary = actionCountKey({
    count: input.actionCounts.applied,
    pluralKey: 'brief.agentSignal.selfReview.applied.summary_plural',
    singularKey: 'brief.agentSignal.selfReview.applied.summary',
    t,
  });

  return {
    priority: 'info',
    summary: withDetails(
      summary,
      t('brief.agentSignal.selfReview.applied.heading'),
      input.actionSummaries.applied,
    ),
    title: t('brief.agentSignal.selfReview.applied.title'),
    type: 'insight',
  };
};

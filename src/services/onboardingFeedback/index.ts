import { topicService } from '@/services/topic';

const COMMENT_MAX_LENGTH = 500;
const FEEDBACK_EVENT_NAME = 'onboarding_feedback_submitted';
const FEEDBACK_SPM = 'onboarding.completion.feedback.submit';

export type OnboardingFeedbackRating = 'good' | 'bad';

export interface OnboardingRatingPayload {
  rating: OnboardingFeedbackRating;
  topicId: string;
}

export interface OnboardingCommentPayload {
  comment: string;
  rating: OnboardingFeedbackRating;
  submittedAt: string;
  topicId: string;
}

export interface OnboardingRatingResult {
  submittedAt: string;
}

interface AnalyticsLike {
  track: (event: { name: string; properties?: Record<string, unknown> }) => unknown;
}

export interface SubmitOnboardingRatingOptions {
  /** Optional analytics client (fire-and-forget). Pass null to skip analytics. */
  analytics?: AnalyticsLike | null;
}

const sanitizeComment = (comment: string | undefined): string | undefined => {
  if (!comment) return undefined;
  const trimmed = comment.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, COMMENT_MAX_LENGTH);
};

/**
 * Fires immediately when the user clicks a thumb. Persists the rating to
 * topic.metadata.onboardingFeedback (gating write) and emits the analytics event
 * best-effort. Returns `submittedAt` so a later comment patch can carry the same
 * timestamp + rating through `topicService.updateTopicMetadata`, which
 * shallow-merges top-level keys.
 */
export const submitOnboardingRating = async (
  payload: OnboardingRatingPayload,
  options: SubmitOnboardingRatingOptions = {},
): Promise<OnboardingRatingResult> => {
  const submittedAt = new Date().toISOString();

  await topicService.updateTopicMetadata(payload.topicId, {
    onboardingFeedback: {
      rating: payload.rating,
      submittedAt,
    },
  });

  try {
    options.analytics?.track({
      name: FEEDBACK_EVENT_NAME,
      properties: {
        rating: payload.rating,
        spm: FEEDBACK_SPM,
      },
    });
  } catch (error) {
    console.error('[OnboardingFeedback] analytics emit failed', error);
  }

  return { submittedAt };
};

/**
 * Patches `topic.metadata.onboardingFeedback` with the user's free-form comment
 * after the rating has been recorded. Carries `rating` + `submittedAt` forward
 * because `updateTopicMetadata` shallow-merges and would otherwise overwrite
 * those fields. No-ops on empty trimmed comment so callers can call unconditionally.
 * The comment is never emitted to analytics — kept on topic.metadata only.
 */
export const submitOnboardingComment = async (payload: OnboardingCommentPayload): Promise<void> => {
  const comment = sanitizeComment(payload.comment);
  if (!comment) return;

  await topicService.updateTopicMetadata(payload.topicId, {
    onboardingFeedback: {
      comment,
      rating: payload.rating,
      submittedAt: payload.submittedAt,
    },
  });
};

export const ONBOARDING_FEEDBACK_CONSTANTS = {
  COMMENT_MAX_LENGTH,
  EVENT_NAME: FEEDBACK_EVENT_NAME,
  SPM: FEEDBACK_SPM,
};

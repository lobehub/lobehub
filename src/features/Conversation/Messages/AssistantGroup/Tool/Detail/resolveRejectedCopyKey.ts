/**
 * All ask surfaces (user-interaction, lobe-agent, claude-code) share this
 * apiName; other skippable interactions (e.g. the onboarding marketplace
 * picker) get the generic skipped copy instead of the question-specific one.
 */
const ASK_USER_QUESTION_API_NAME = 'askUserQuestion';

interface ResolveRejectedCopyKeyInput {
  apiName?: string;
  reason?: string;
  skipped?: boolean;
  /** The producer stopped waiting before anyone answered. */
  timedOut?: boolean;
}

/**
 * Picks the i18n key for a rejected tool intervention: a producer timeout
 * renders as a neutral note stating nobody answered, user skips render as a
 * neutral note (question-specific for ask surfaces), true rejections keep the
 * warning copy.
 */
export const resolveRejectedCopyKey = ({
  apiName,
  reason,
  skipped,
  timedOut,
}: ResolveRejectedCopyKeyInput):
  | 'tool.intervention.questionSkipped'
  | 'tool.intervention.questionTimedOut'
  | 'tool.intervention.rejectedWithReason'
  | 'tool.intervention.toolRejected'
  | 'tool.intervention.toolSkipped' => {
  // A timeout is nobody's decision — it outranks the skip/reject copy, which
  // would otherwise blame the user for a question they were never shown in time.
  if (timedOut) return 'tool.intervention.questionTimedOut';

  if (skipped)
    return apiName === ASK_USER_QUESTION_API_NAME
      ? 'tool.intervention.questionSkipped'
      : 'tool.intervention.toolSkipped';

  return reason ? 'tool.intervention.rejectedWithReason' : 'tool.intervention.toolRejected';
};

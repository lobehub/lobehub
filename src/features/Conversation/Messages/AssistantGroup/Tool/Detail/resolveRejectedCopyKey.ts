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
}

/**
 * Picks the i18n key for a rejected tool intervention: user skips render as a
 * neutral note (question-specific for ask surfaces), true rejections keep the
 * warning copy.
 */
export const resolveRejectedCopyKey = ({
  apiName,
  reason,
  skipped,
}: ResolveRejectedCopyKeyInput):
  | 'tool.intervention.questionSkipped'
  | 'tool.intervention.rejectedWithReason'
  | 'tool.intervention.toolRejected'
  | 'tool.intervention.toolSkipped' => {
  if (skipped)
    return apiName === ASK_USER_QUESTION_API_NAME
      ? 'tool.intervention.questionSkipped'
      : 'tool.intervention.toolSkipped';

  return reason ? 'tool.intervention.rejectedWithReason' : 'tool.intervention.toolRejected';
};

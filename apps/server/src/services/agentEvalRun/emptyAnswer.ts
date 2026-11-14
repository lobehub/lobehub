/** Error text of an attempt the model ended without saying anything. */
export const ENDED_WITHOUT_ANSWER = 'Ended without a final answer';

/** Error text of an attempt with no usable assistant turn: it never got an answer from the provider. */
export const NO_ASSISTANT_OUTPUT = 'No assistant output';

/**
 * An attempt graded before an empty answer from a normally finished turn
 * counted as a failure: grading it again applies the current reading
 * (`classifyEmptyAnswer`), which keeps a real provider error an error.
 */
export const isRegradableEmptyAnswer = (attempt?: { error?: unknown; status?: unknown } | null) =>
  attempt?.status === 'error' && attempt.error === NO_ASSISTANT_OUTPUT;

/** Completion reasons that mean the execution itself broke, not that the model stopped. */
const BROKEN_COMPLETIONS = new Set(['aborted', 'error', 'interrupted']);

/**
 * How an attempt whose last assistant message has no text is graded.
 *
 * - It ran into its step cap: the model kept calling tools instead of
 *   answering, a failure.
 * - The provider finished the turn normally (the message carries no error and
 *   the execution was not broken) but the model left no text, for example a
 *   tool call it announced and never sent: the model's outcome, a failure. A
 *   rerun meets the same model and usually the same result, so it is not held
 *   back as unverified.
 * - Otherwise (no assistant message, a provider error on it, a broken
 *   execution) it stays an infrastructure error.
 */
export const classifyEmptyAnswer = ({
  completionReason,
  lastAssistantMessage,
  stepCap,
  steps,
}: {
  completionReason?: string;
  lastAssistantMessage?: { error?: unknown } | null;
  stepCap?: number;
  steps?: number;
}): { error: string; status: 'error' | 'failed' } => {
  if (stepCap && (steps ?? 0) >= stepCap)
    return {
      error: `Reached the step limit (${stepCap}) without a final answer`,
      status: 'failed',
    };
  if (
    lastAssistantMessage &&
    !lastAssistantMessage.error &&
    !BROKEN_COMPLETIONS.has(completionReason ?? '')
  )
    return { error: ENDED_WITHOUT_ANSWER, status: 'failed' };
  return { error: NO_ASSISTANT_OUTPUT, status: 'error' };
};

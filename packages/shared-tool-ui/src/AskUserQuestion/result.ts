export interface AskUserQuestionResultState {
  askUserAnswers?: Record<string, string | string[]>;
}

const USER_SUBMITTED_PREFIX = 'User submitted:';

const normalizeAnswers = (value: unknown): Record<string, string | string[]> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | string[]] =>
      typeof entry[1] === 'string' ||
      (Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string')),
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/**
 * Resolve the structured answers for a completed AskUserQuestion call.
 *
 * New messages persist `pluginState.askUserAnswers`. Older builtin calls only
 * stored `User submitted: {...}` in the tool result, so keep that lightweight
 * compatibility path instead of exposing the generic JSON result renderer.
 */
export const resolveAskUserAnswers = (
  pluginState: AskUserQuestionResultState | undefined,
  content: unknown,
): Record<string, string | string[]> | undefined => {
  const persisted = normalizeAnswers(pluginState?.askUserAnswers);
  if (persisted) return persisted;

  if (typeof content !== 'string') return;

  const prefixIndex = content.indexOf(USER_SUBMITTED_PREFIX);
  if (prefixIndex < 0) return;

  try {
    return normalizeAnswers(JSON.parse(content.slice(prefixIndex + USER_SUBMITTED_PREFIX.length)));
  } catch {
    return;
  }
};

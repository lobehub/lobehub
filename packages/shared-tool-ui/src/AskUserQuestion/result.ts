import type { AskUserQuestionItem } from './types';

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

const FREEFORM_KEY = '__freeform__';

export const summarizeAskUserAnswers = (
  questions: AskUserQuestionItem[],
  answers: Record<string, string | string[]> | undefined,
): string | undefined => {
  if (!answers) return;

  const freeform = answers[FREEFORM_KEY];
  if (typeof freeform === 'string' && freeform.trim()) return freeform.trim();

  const toLabel = (question: AskUserQuestionItem, value: string) =>
    question.options.find((option) => option.id === value)?.label ?? value;

  const first = questions.find((question) => {
    const value = answers[question.question];
    return Array.isArray(value) ? value.length > 0 : !!value;
  });
  if (!first) return;

  const value = answers[first.question];
  const text = (Array.isArray(value) ? value : [value]).map((v) => toLabel(first, v)).join(', ');
  return questions.length > 1 ? `${text} +${questions.length - 1}` : text;
};

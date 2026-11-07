interface CaseLike {
  content?: { input?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The one line a person reads for a case in a list: its declared
 * `metadata.title` when it has one, else its input on a single line — the
 * first line of a prompt, or the whole of a JSON input with its line breaks
 * folded (its first line alone is only `{`). Lists clip it with an ellipsis.
 */
export const getCaseLabel = (testCase?: CaseLike | null): string => {
  const title = testCase?.metadata?.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  const input = (testCase?.content?.input ?? '').trim();
  if (/^[[{]/.test(input)) return input.replaceAll(/\s+/g, ' ');
  return (
    input
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  );
};

/** Whether the label comes from a declared title rather than the input. */
export const hasCaseTitle = (testCase?: CaseLike | null) => {
  const title = testCase?.metadata?.title;
  return typeof title === 'string' && !!title.trim();
};

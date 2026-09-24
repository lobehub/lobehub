const normalizeErrorText = (value?: string | null) => value?.replaceAll(/\s+/g, ' ').trim();

/**
 * Whether an assistant's streamed `content` is nothing but an echo of the
 * terminal error.
 *
 * Some CLIs print the failure to stdout before (or instead of) reporting it
 * structurally — CC echoes the stderr line for an auth failure, and a quota
 * rejection can arrive the same way. Dropping that content leaves the error
 * card as the only rendering of the failure instead of showing it twice.
 *
 * Equality, never containment: a run that produced real work and THEN died on
 * its quota (Kimi Code exits mid-run when the weekly window closes) must keep
 * every word it wrote. Accidental partial overlap is not an echo.
 */
export const isEchoedErrorText = (
  content: string | null | undefined,
  errorText: string | null | undefined,
): boolean => {
  const normalizedContent = normalizeErrorText(content);
  const normalizedError = normalizeErrorText(errorText);

  return !!normalizedContent && !!normalizedError && normalizedContent === normalizedError;
};

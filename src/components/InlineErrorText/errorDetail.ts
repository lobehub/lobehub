/**
 * Server-side cause carried by a caught error, used as the folded "Show details"
 * text under an actionable inline summary. Returns `undefined` when there is no
 * message worth showing, or when the message would only repeat the summary.
 */
export const getErrorDetail = (error: unknown, summary?: string): string | undefined => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof (error as { message?: unknown } | null)?.message === 'string'
          ? (error as { message: string }).message
          : undefined;

  const trimmed = message?.trim();
  if (!trimmed || trimmed === summary?.trim()) return undefined;

  return trimmed;
};

/** Inline error state: an actionable summary plus the optional raw cause. */
export interface InlineErrorState {
  detail?: string;
  summary: string;
}

/** Build inline error state from a caught error and its translated summary. */
export const toInlineError = (summary: string, error?: unknown): InlineErrorState => ({
  detail: getErrorDetail(error, summary),
  summary,
});

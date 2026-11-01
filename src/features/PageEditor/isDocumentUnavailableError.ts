import { isTrpcErrorCode } from '@/utils/trpcError';

/**
 * Whether a page section failed because the document itself is closed to this
 * member (another member's private page) or gone. The body already explains that
 * state, so sections below it (likes, comments) render nothing instead of
 * stacking their own failures under it.
 */
export const isDocumentUnavailableError = (error: unknown): boolean =>
  isTrpcErrorCode(error, 'FORBIDDEN') || isTrpcErrorCode(error, 'NOT_FOUND');

/**
 * What a page section shows for its load result. SWR keeps the last data next
 * to a revalidation error, so an unavailable page is judged on the error alone:
 * cached likes or threads of a page that went private must disappear too.
 */
export const resolveDocumentSectionState = (
  data: unknown,
  error: unknown,
): 'error' | 'hidden' | 'ready' => {
  if (isDocumentUnavailableError(error)) return 'hidden';
  if (data === undefined && error) return 'error';
  return 'ready';
};

/**
 * Whether the page's comments must disappear entirely. Either thread list can
 * be the one that sees the terminal error first; cached pages next to it do not
 * keep the comments available.
 */
export const isDocumentCommentsUnavailable = (state: {
  anchoredError?: unknown;
  documentThreads: { error?: unknown };
}): boolean =>
  isDocumentUnavailableError(state.documentThreads.error) ||
  isDocumentUnavailableError(state.anchoredError);

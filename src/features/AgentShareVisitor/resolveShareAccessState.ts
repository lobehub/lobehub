import { isTrpcErrorCode } from '@/utils/trpcError';

/**
 * How a failed `share.getSharedAgent` should be presented to the visitor.
 *
 * - `signIn`  — the procedure is authed; an anonymous visitor gets
 *   `UNAUTHORIZED` and needs a sign-in CTA rather than an error page. The
 *   service opts out of the global 401 redirect precisely so this branch can
 *   render (see `agentShareService.getSharedAgent`).
 * - `notFound` — no share resolves for this slug/id, or the creator turned
 *   sharing off (`assertShareAccess` answers `NOT_FOUND` for a stranger on a
 *   private share so a link cannot be used to probe for its existence).
 * - `forbidden` — the share exists but this account may not open it.
 * - `generic` — anything else (network / server fault): retryable.
 */
export type ShareAccessState = 'forbidden' | 'generic' | 'notFound' | 'signIn';

export const resolveShareAccessState = (error: unknown): ShareAccessState => {
  if (isTrpcErrorCode(error, 'UNAUTHORIZED')) return 'signIn';
  if (isTrpcErrorCode(error, 'NOT_FOUND')) return 'notFound';
  if (isTrpcErrorCode(error, 'FORBIDDEN')) return 'forbidden';
  return 'generic';
};

/** Visitor-facing copy key for a non-retryable access state. */
export const SHARE_ACCESS_ERROR_KEYS: Record<
  Exclude<ShareAccessState, 'generic' | 'signIn'>,
  string
> = {
  forbidden: 'share.visitor.access.forbidden',
  notFound: 'share.visitor.access.notFound',
};

/**
 * Shared sandbox error predicates.
 *
 * `isSandboxAuthError` gates the execInSandbox re-auth prompt, so it must
 * agree with the Market transport's auth error vocabulary in both directions:
 * a name the SDK stops using, or a message wording it never produced, turns a
 * recoverable re-auth into a generic tool failure.
 */
export const isSandboxAuthError = (error?: { message?: string; name?: string }) => {
  const code = error?.name;
  const message = error?.message || '';

  return (
    code === 'invalid_token' ||
    code === 'token_expired' ||
    code === 'unauthorized' ||
    message.toLowerCase().includes('invalid_token') ||
    message.toLowerCase().includes('token expired') ||
    message.toLowerCase().includes('unauthorized')
  );
};

/**
 * The structured access-denied marker `getToolAccessDeniedError` emits. `kind`
 * is not part of `ServiceResult['error']` — it survives only because callers
 * spread the producer's object — so it is read through `unknown`, not the
 * declared shape.
 */
export const isSandboxAccessDeniedError = (error: unknown) =>
  typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'stop';

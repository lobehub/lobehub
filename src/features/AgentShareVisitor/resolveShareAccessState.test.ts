import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import { resolveShareAccessState } from './resolveShareAccessState';

const trpcError = (code: string) =>
  new TRPCClientError(code, {
    result: { error: { code: -32_600, data: { code }, message: code } },
  });

describe('resolveShareAccessState', () => {
  it('routes an anonymous visitor to the sign-in prompt rather than an error page', () => {
    expect(resolveShareAccessState(trpcError('UNAUTHORIZED'))).toBe('signIn');
  });

  it('maps a missing or disabled share to notFound', () => {
    expect(resolveShareAccessState(trpcError('NOT_FOUND'))).toBe('notFound');
  });

  it('maps an access rejection to forbidden', () => {
    expect(resolveShareAccessState(trpcError('FORBIDDEN'))).toBe('forbidden');
  });

  it('treats anything else as a retryable generic failure', () => {
    expect(resolveShareAccessState(trpcError('INTERNAL_SERVER_ERROR'))).toBe('generic');
    expect(resolveShareAccessState(new Error('network down'))).toBe('generic');
    expect(resolveShareAccessState(undefined)).toBe('generic');
  });
});

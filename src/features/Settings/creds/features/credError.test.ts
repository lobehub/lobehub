import { describe, expect, it } from 'vitest';

import { credErrorKey } from './credError';

const trpcError = (code: string, message: string) =>
  Object.assign(new Error(message), { data: { code } });

describe('credErrorKey', () => {
  it("names Market's conflict reasons", () => {
    expect(credErrorKey(trpcError('CONFLICT', 'public_cred_exists'), 'fallback')).toBe(
      'creds.errors.publicCredExists',
    );
    expect(credErrorKey(trpcError('CONFLICT', 'multi_org_share_disabled'), 'fallback')).toBe(
      'creds.errors.multiOrgShareDisabled',
    );
    expect(credErrorKey(trpcError('CONFLICT', 'private_cred_exists'), 'fallback')).toBe(
      'creds.errors.privateCredExists',
    );
    expect(credErrorKey(trpcError('CONFLICT', 'private_creds_disabled'), 'fallback')).toBe(
      'creds.errors.privateCredsDisabled',
    );
  });

  it('falls back for any other failure', () => {
    expect(credErrorKey(trpcError('CONFLICT', 'something else'), 'fallback')).toBe('fallback');
    expect(credErrorKey(trpcError('FORBIDDEN', 'public_cred_exists'), 'fallback')).toBe('fallback');
    expect(credErrorKey('boom', 'fallback')).toBe('fallback');
  });
});

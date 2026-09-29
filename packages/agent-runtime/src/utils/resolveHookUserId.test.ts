import { describe, expect, it } from 'vitest';

import { resolveHookUserId } from './resolveHookUserId';

describe('resolveHookUserId', () => {
  it('exposes the trusted visitor without changing the run account', () => {
    const operation = { userId: 'owner' };
    const shareVisitor = { visitorUserId: 'visitor' };
    expect(resolveHookUserId(operation.userId, shareVisitor)).toBe('visitor');
    expect(operation.userId).toBe('owner');
    expect(shareVisitor).toEqual({ visitorUserId: 'visitor' });
  });

  it.each([undefined, null, {}])('keeps the original user when share context is %j', (share) => {
    expect(resolveHookUserId('owner', share)).toBe('owner');
    expect(resolveHookUserId(undefined, share)).toBeUndefined();
  });

  it('uses nullish fallback, including for an absent original user', () => {
    expect(resolveHookUserId(undefined, { visitorUserId: 'visitor' })).toBe('visitor');
    expect(resolveHookUserId('owner', { visitorUserId: '' })).toBe('');
  });
});

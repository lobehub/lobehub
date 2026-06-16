import { describe, expect, it } from 'vitest';

import { isLockedByOtherSession } from './usePageLockedByOther';

describe('isLockedByOtherSession', () => {
  it('is not locked when no one holds the lock', () => {
    expect(
      isLockedByOtherSession({
        holderId: null,
        holderOwnerId: null,
        myOwnerId: 'page-owner-1',
        myUserId: 'user-1',
      }),
    ).toBe(false);
  });

  it('is locked when another user holds the lock', () => {
    expect(
      isLockedByOtherSession({
        holderId: 'user-2',
        holderOwnerId: 'page-owner-2',
        myOwnerId: 'page-owner-1',
        myUserId: 'user-1',
      }),
    ).toBe(true);
  });

  it('is not locked when I hold the lock from this session', () => {
    expect(
      isLockedByOtherSession({
        holderId: 'user-1',
        holderOwnerId: 'page-owner-1',
        myOwnerId: 'page-owner-1',
        myUserId: 'user-1',
      }),
    ).toBe(false);
  });

  it('is locked when the same user holds the lock from a different session/tab', () => {
    expect(
      isLockedByOtherSession({
        holderId: 'user-1',
        holderOwnerId: 'page-owner-2',
        myOwnerId: 'page-owner-1',
        myUserId: 'user-1',
      }),
    ).toBe(true);
  });

  it('is not locked by a legacy same-user lock that has no owner session', () => {
    // Rolling-deploy compatibility: a pre-upgrade lock stores no ownerId. Treat
    // it as mine so I am never locked out by my own (legacy) lock.
    expect(
      isLockedByOtherSession({
        holderId: 'user-1',
        holderOwnerId: null,
        myOwnerId: 'page-owner-1',
        myUserId: 'user-1',
      }),
    ).toBe(false);
  });

  it('is not locked by the same user when my own session owner is unknown', () => {
    expect(
      isLockedByOtherSession({
        holderId: 'user-1',
        holderOwnerId: 'page-owner-2',
        myOwnerId: undefined,
        myUserId: 'user-1',
      }),
    ).toBe(false);
  });
});

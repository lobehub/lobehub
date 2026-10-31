import { describe, expect, it } from 'vitest';

import { goalVisibilityLockKey } from './goalVisibilityLock';

describe('goalVisibilityLockKey', () => {
  it('lets the creator switch a goal on public agents either way', () => {
    for (const visibility of ['private', 'public'] as const)
      expect(
        goalVisibilityLockKey({ agentPrivate: false, ownerId: 'u1', viewerId: 'u1', visibility }),
      ).toBeUndefined();
  });

  it('locks it for anyone but the creator, workspace owners included', () => {
    expect(
      goalVisibilityLockKey({
        agentPrivate: false,
        ownerId: 'u1',
        viewerId: 'u2',
        visibility: 'public',
      }),
    ).toBe('goalDetail.visibility.creatorOnly');
  });

  it('locks it while the profile has not loaded', () => {
    expect(
      goalVisibilityLockKey({
        agentPrivate: false,
        ownerId: 'u1',
        viewerId: undefined,
        visibility: 'public',
      }),
    ).toBe('goalDetail.visibility.creatorOnly');
  });

  it('keeps a goal a private agent runs private, but still lets it go private', () => {
    expect(
      goalVisibilityLockKey({
        agentPrivate: true,
        ownerId: 'u1',
        viewerId: 'u1',
        visibility: 'private',
      }),
    ).toBe('goalDetail.visibility.privateAgentLocked');
    // A legacy public goal on a private agent can still be fixed by going private.
    expect(
      goalVisibilityLockKey({
        agentPrivate: true,
        ownerId: 'u1',
        viewerId: 'u1',
        visibility: 'public',
      }),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { resolveCollaborationUser } from './collaborationUser';

describe('resolveCollaborationUser', () => {
  it('uses the signed-in display name and keeps the stable user id', () => {
    expect(resolveCollaborationUser({ displayName: 'Alice Chen', userId: 'user-alice' })).toEqual({
      color: expect.stringMatching(/^#[0-9a-f]{6}$/),
      name: 'Alice Chen',
      userId: 'user-alice',
    });
  });

  it('assigns a deterministic color per identity', () => {
    const first = resolveCollaborationUser({ displayName: 'Alice', userId: 'user-alice' });
    const second = resolveCollaborationUser({ displayName: 'Renamed Alice', userId: 'user-alice' });

    expect(second.color).toBe(first.color);
  });

  it('falls back safely before the user profile loads', () => {
    expect(resolveCollaborationUser({})).toMatchObject({ name: 'Anonymous' });
  });
});

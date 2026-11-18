import { describe, expect, it } from 'vitest';

import { toWorkspaceMemberProfile } from './useWorkspaceMemberProfile';

const member = (overrides: Record<string, unknown> = {}) =>
  ({
    config: {},
    deletedAt: null,
    joinedAt: new Date(),
    responsibilities: '  Owns billing and the enterprise rollout ',
    role: 'admin',
    title: ' Product Lead ',
    updatedAt: new Date(),
    user: {
      avatar: 'https://example.com/a.png',
      email: 'jian@example.com',
      fullName: 'Jian Xu',
      username: 'jianxu',
    },
    userId: 'user-1',
    workspaceId: 'ws-1',
    ...overrides,
  }) as any;

describe('toWorkspaceMemberProfile', () => {
  it('projects an active member with their trimmed workspace title and responsibilities', () => {
    expect(toWorkspaceMemberProfile([member()], 'user-1')).toEqual({
      avatar: 'https://example.com/a.png',
      email: 'jian@example.com',
      name: 'Jian Xu',
      responsibilities: 'Owns billing and the enterprise rollout',
      role: 'admin',
      title: 'Product Lead',
      userId: 'user-1',
      username: 'jianxu',
    });
  });

  it('falls back to the username, then the email local part, for the name', () => {
    const members = [
      member({ user: { email: 'a@example.com', fullName: ' ', username: 'alpha' } }),
      member({ user: { email: 'beta@example.com' }, userId: 'user-2' }),
    ];

    expect(toWorkspaceMemberProfile(members, 'user-1')?.name).toBe('alpha');
    expect(toWorkspaceMemberProfile(members, 'user-2')?.name).toBe('beta');
  });

  it('treats blank title and responsibilities as absent', () => {
    const profile = toWorkspaceMemberProfile(
      [member({ responsibilities: '   ', title: null })],
      'user-1',
    );

    expect(profile?.title).toBeNull();
    expect(profile?.responsibilities).toBeNull();
  });

  it('returns nothing for a removed member, a stranger or a missing id', () => {
    expect(toWorkspaceMemberProfile([member({ deletedAt: new Date() })], 'user-1')).toBeUndefined();
    expect(toWorkspaceMemberProfile([member()], 'someone-else')).toBeUndefined();
    expect(toWorkspaceMemberProfile([member()], null)).toBeUndefined();
    expect(toWorkspaceMemberProfile([], 'user-1')).toBeUndefined();
  });
});

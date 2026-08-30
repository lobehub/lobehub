import { describe, expect, it } from 'vitest';

import { resolveRecentGroupAvatar } from '../HomeModeContent';

describe('resolveRecentGroupAvatar', () => {
  it('uses a custom group avatar', () => {
    expect(resolveRecentGroupAvatar('group-avatar')).toEqual({
      customAvatar: 'group-avatar',
      hasAvatar: true,
      memberAvatars: [],
    });
  });

  it('uses member avatars when the group has no custom avatar', () => {
    const memberAvatars = [{ avatar: 'member-avatar', background: '#123456' }];

    expect(resolveRecentGroupAvatar(memberAvatars)).toEqual({
      customAvatar: undefined,
      hasAvatar: true,
      memberAvatars,
    });
  });

  it('reports no group avatar when neither source exists', () => {
    expect(resolveRecentGroupAvatar(null)).toEqual({
      customAvatar: undefined,
      hasAvatar: false,
      memberAvatars: [],
    });
  });
});

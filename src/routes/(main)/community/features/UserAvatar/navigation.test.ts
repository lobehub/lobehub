import { describe, expect, it } from 'vitest';

import { resolveCommunityUserAvatarTarget } from './navigation';

describe('resolveCommunityUserAvatarTarget', () => {
  it('routes workspace scope to the workspace community page even before an org namespace exists', () => {
    expect(
      resolveCommunityUserAvatarTarget({
        isWorkspaceScope: true,
        profileUsername: 'personal-user',
      }),
    ).toBe('/community/workspace');
  });

  it('routes personal scope to the user profile when available', () => {
    expect(
      resolveCommunityUserAvatarTarget({
        isWorkspaceScope: false,
        profileUsername: 'personal-user',
      }),
    ).toBe('/community/user/personal-user');
  });
});

import { describe, expect, it } from 'vitest';

import {
  resolveCommunityProfileUsername,
  resolveWorkspaceCommunityProfile,
  resolveWorkspaceCommunityProfileRedirect,
  shouldShowWorkspaceProfileEdit,
} from './resolveWorkspaceProfileEdit';

describe('shouldShowWorkspaceProfileEdit', () => {
  it('returns true for the active workspace organization when editing is allowed', () => {
    expect(
      shouldShowWorkspaceProfileEdit({
        canEdit: true,
        marketOrganizationProfile: { accountId: 42 },
        user: { id: 42, type: 'organization' },
      }),
    ).toBe(true);
  });

  it('returns false for personal user profiles', () => {
    expect(
      shouldShowWorkspaceProfileEdit({
        canEdit: true,
        marketOrganizationProfile: { accountId: 42 },
        user: { id: 42, type: 'user' },
      }),
    ).toBe(false);
  });

  it('returns false for a different organization profile', () => {
    expect(
      shouldShowWorkspaceProfileEdit({
        canEdit: true,
        marketOrganizationProfile: { accountId: 42 },
        user: { id: 99, type: 'organization' },
      }),
    ).toBe(false);
  });

  it('returns false when the caller cannot edit the workspace', () => {
    expect(
      shouldShowWorkspaceProfileEdit({
        canEdit: false,
        marketOrganizationProfile: { accountId: 42 },
        user: { id: 42, type: 'organization' },
      }),
    ).toBe(false);
  });

  it('returns true for an owner before the Market organization is provisioned', () => {
    expect(
      shouldShowWorkspaceProfileEdit({
        canEdit: true,
        marketOrganizationProfile: null,
        user: { id: 0, type: 'organization' },
      }),
    ).toBe(true);
  });

  it('returns false for a non-owner before the Market organization is provisioned', () => {
    expect(
      shouldShowWorkspaceProfileEdit({
        canEdit: false,
        marketOrganizationProfile: null,
        user: { id: 0, type: 'organization' },
      }),
    ).toBe(false);
  });
});

describe('resolveCommunityProfileUsername', () => {
  it('uses the workspace organization username in workspace scope', () => {
    expect(
      resolveCommunityProfileUsername({
        routeUsername: 'personal-user',
        workspaceUsername: 'ws-team',
      }),
    ).toBe('ws-team');
  });

  it('uses the route username outside workspace scope', () => {
    expect(
      resolveCommunityProfileUsername({
        routeUsername: 'personal-user',
      }),
    ).toBe('personal-user');
  });
});

describe('resolveWorkspaceCommunityProfileRedirect', () => {
  it('redirects workspace user URLs to the workspace Community page', () => {
    expect(
      resolveWorkspaceCommunityProfileRedirect({
        isWorkspaceScope: true,
        pathname: '/hug/community/user/rdmclin2',
      }),
    ).toBe('/community/workspace');
  });

  it('redirects workspace org URLs to the workspace Community page', () => {
    expect(
      resolveWorkspaceCommunityProfileRedirect({
        isWorkspaceScope: true,
        pathname: '/hug/community/org/other',
        search: '?tab=skills',
      }),
    ).toBe('/community/workspace?tab=skills');
  });

  it('keeps the current URL outside workspace scope', () => {
    expect(
      resolveWorkspaceCommunityProfileRedirect({
        isWorkspaceScope: false,
        pathname: '/community/user/rdmclin2',
      }),
    ).toBeNull();
  });
});

describe('resolveWorkspaceCommunityProfile', () => {
  const baseProfile = {
    agentGroups: [],
    agents: [],
    favoriteAgentGroups: [],
    favoriteAgents: [],
    forkedAgentGroups: [],
    forkedAgents: [],
    plugins: [],
    skills: [],
    user: {
      avatarUrl: null,
      bannerUrl: null,
      createdAt: '',
      description: null,
      displayName: 'Market workspace',
      followersCount: 0,
      followingCount: 0,
      id: 42,
      namespace: 'ws-xuxu',
      socialLinks: null,
      type: 'organization',
      userName: null,
    },
  };

  it('uses workspace avatar when the Market organization profile has no avatar', () => {
    expect(
      resolveWorkspaceCommunityProfile({
        fallbackProfile: {
          ...baseProfile,
          user: {
            ...baseProfile.user,
            avatarUrl: '/avatars/workspace.png',
            displayName: 'xuxu',
          },
        },
        marketProfile: baseProfile,
      })?.user.avatarUrl,
    ).toBe('/avatars/workspace.png');
  });
});

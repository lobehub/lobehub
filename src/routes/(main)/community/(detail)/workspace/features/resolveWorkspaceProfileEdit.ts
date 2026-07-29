import type { DiscoverUserProfile } from '@/types/discover';

interface CommunityProfileOwner {
  id: number;
  type?: string | null;
}

interface MarketOrganizationProfileRef {
  accountId: number;
}

interface ShouldShowWorkspaceProfileEditParams {
  canEdit: boolean;
  marketOrganizationProfile?: MarketOrganizationProfileRef | null;
  user: CommunityProfileOwner;
}

interface ResolveCommunityProfileUsernameParams {
  routeUsername: string;
  workspaceUsername?: string | null;
}

interface ResolveWorkspaceCommunityProfileRedirectParams {
  isWorkspaceScope: boolean;
  pathname: string;
  search?: string;
}

interface ResolveWorkspaceCommunityProfileParams {
  fallbackProfile: DiscoverUserProfile | null;
  marketProfile?: DiscoverUserProfile;
}

export const shouldShowWorkspaceProfileEdit = ({
  canEdit,
  marketOrganizationProfile,
  user,
}: ShouldShowWorkspaceProfileEditParams) => {
  if (!canEdit || user.type !== 'organization') return false;
  // The workspace's mirror Market organization is provisioned lazily (on the
  // first write to Market). Before it exists, `marketOrganizationProfile` is
  // null — an owner should still see the edit entry on their own workspace
  // Community page; saving provisions the organization on demand. Once
  // provisioned, the accountId must match the viewed profile so the edit entry
  // never leaks onto a different organization's page.
  if (!marketOrganizationProfile) return true;
  return marketOrganizationProfile.accountId === user.id;
};

export const resolveCommunityProfileUsername = ({
  routeUsername,
  workspaceUsername,
}: ResolveCommunityProfileUsernameParams) => workspaceUsername || routeUsername;

export const resolveWorkspaceCommunityProfile = ({
  fallbackProfile,
  marketProfile,
}: ResolveWorkspaceCommunityProfileParams): DiscoverUserProfile | null => {
  if (!marketProfile) return fallbackProfile;
  if (!fallbackProfile) return marketProfile;

  return {
    ...marketProfile,
    user: {
      ...marketProfile.user,
      avatarUrl: marketProfile.user.avatarUrl || fallbackProfile.user.avatarUrl,
      description: marketProfile.user.description ?? fallbackProfile.user.description,
      displayName: marketProfile.user.displayName || fallbackProfile.user.displayName,
    },
  };
};

export const resolveWorkspaceCommunityProfileRedirect = ({
  isWorkspaceScope,
  pathname,
  search = '',
}: ResolveWorkspaceCommunityProfileRedirectParams) => {
  if (!isWorkspaceScope) return null;

  const targetPath = '/community/workspace';
  if (pathname.endsWith(targetPath)) return null;
  if (!pathname.includes('/community/user/') && !pathname.includes('/community/org/')) return null;

  return `${targetPath}${search}`;
};

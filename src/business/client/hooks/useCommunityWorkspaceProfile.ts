'use client';

export interface CommunityWorkspaceMarketOrganizationProfile {
  accountId: number;
  avatarUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  displayName: string | null;
  namespace: string;
  websiteUrl: string | null;
}

export interface CommunityWorkspaceProfileState {
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  canEdit: boolean;
  description?: string | null;
  displayName?: string | null;
  isLoading: boolean;
  isWorkspaceScope: boolean;
  profile: CommunityWorkspaceMarketOrganizationProfile | null;
  refresh: () => Promise<void>;
  username?: string;
}

export const useCommunityWorkspaceProfile = (): CommunityWorkspaceProfileState => ({
  avatarUrl: null,
  bannerUrl: null,
  canEdit: false,
  description: null,
  displayName: null,
  isLoading: false,
  isWorkspaceScope: false,
  profile: null,
  refresh: async () => {},
});

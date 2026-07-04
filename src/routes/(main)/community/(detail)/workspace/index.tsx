'use client';

import { Center } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';

import { useCommunityWorkspaceProfile } from '@/business/client/hooks/useCommunityWorkspaceProfile';
import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDiscoverStore } from '@/store/discover';
import type { DiscoverUserProfile } from '@/types/discover';

import NotFound from '../components/NotFound';
import { WorkspaceDetailProvider } from './features/DetailProvider';
import WorkspaceHeader from './features/Header';
import {
  resolveWorkspaceCommunityProfile,
  shouldShowWorkspaceProfileEdit,
} from './features/resolveWorkspaceProfileEdit';
import WorkspaceContent from './features/WorkspaceContent';
import { openWorkspaceProfileModal } from './features/WorkspaceProfileModal';
import Loading from './loading';

interface WorkspaceDetailPageProps {
  mobile?: boolean;
}

const WorkspaceDetailPage = memo<WorkspaceDetailPageProps>(({ mobile }) => {
  const {
    avatarUrl: workspaceAvatarUrl,
    bannerUrl: workspaceBannerUrl,
    canEdit,
    description: workspaceDescription,
    displayName: workspaceDisplayName,
    isLoading: isWorkspaceProfileLoading,
    profile: marketOrganizationProfile,
    refresh: refreshWorkspaceProfile,
    username: workspaceUsername,
  } = useCommunityWorkspaceProfile();
  const navigate = useWorkspaceAwareNavigate();

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const {
    data,
    error: userProfileError,
    isLoading: isUserProfileLoading,
    mutate,
  } = useUserProfile({
    username: workspaceUsername ?? '',
  });

  // Fallback profile so the page header renders even before the market profile is materialized
  const fallbackProfile = useMemo<DiscoverUserProfile | null>(() => {
    const displayName = workspaceDisplayName ?? workspaceUsername;
    if (!displayName) return null;

    return {
      agentGroups: [],
      agents: [],
      favoriteAgentGroups: [],
      favoriteAgents: [],
      forkedAgentGroups: [],
      forkedAgents: [],
      plugins: [],
      skills: [],
      user: {
        avatarUrl: workspaceAvatarUrl ?? null,
        bannerUrl: workspaceBannerUrl ?? null,
        createdAt: '',
        description: workspaceDescription ?? null,
        displayName,
        followersCount: 0,
        followingCount: 0,
        id: marketOrganizationProfile?.accountId ?? 0,
        namespace: workspaceUsername ?? '',
        socialLinks: null,
        type: 'organization',
        userName: null,
      },
    };
  }, [
    marketOrganizationProfile?.accountId,
    workspaceAvatarUrl,
    workspaceBannerUrl,
    workspaceDescription,
    workspaceDisplayName,
    workspaceUsername,
  ]);

  const profileData = useMemo(
    () =>
      resolveWorkspaceCommunityProfile({
        fallbackProfile,
        marketProfile: data,
      }),
    [data, fallbackProfile],
  );

  const handleEditWorkspaceProfile = useCallback(() => {
    if (marketOrganizationProfile) {
      navigate('/community/workspace/settings');
      return;
    }

    if (!profileData?.user) return;

    openWorkspaceProfileModal({
      onSuccess: async () => {
        await Promise.all([mutate(), refreshWorkspaceProfile()]);
      },
      user: profileData.user,
    });
  }, [marketOrganizationProfile, mutate, navigate, profileData?.user, refreshWorkspaceProfile]);

  const handleRefreshWorkspaceProfile = useCallback(async () => {
    await Promise.all([mutate(), refreshWorkspaceProfile()]);
  }, [mutate, refreshWorkspaceProfile]);

  const contextConfig = useMemo(() => {
    if (!profileData?.user) return null;
    const { user, agents, agentGroups, skills, plugins } = profileData;
    const totalInstalls = agents.reduce((sum, agent) => sum + (agent.installCount || 0), 0);
    const canEditCurrent = shouldShowWorkspaceProfileEdit({
      canEdit,
      marketOrganizationProfile,
      user,
    });

    return {
      agentCount: agents.length,
      agentGroups: agentGroups || [],
      agents,
      canEdit: canEditCurrent,
      groupCount: agentGroups?.length || 0,
      isLoading: isWorkspaceProfileLoading || isUserProfileLoading,
      mobile,
      onEditWorkspaceProfile: canEditCurrent ? handleEditWorkspaceProfile : undefined,
      onRefreshProfile: handleRefreshWorkspaceProfile,
      plugins: plugins || [],
      skills: skills || [],
      totalInstalls,
      user,
    };
  }, [
    canEdit,
    handleEditWorkspaceProfile,
    handleRefreshWorkspaceProfile,
    isUserProfileLoading,
    isWorkspaceProfileLoading,
    marketOrganizationProfile,
    mobile,
    profileData,
  ]);

  if ((isWorkspaceProfileLoading || isUserProfileLoading) && !fallbackProfile) return <Loading />;
  if (!contextConfig) {
    // A transient profile fetch failure must not masquerade as "workspace not
    // found" — offer Reload. Only a resolved-empty profile is a real 404
    // (LOBE-11223). `fallbackProfile` would have yielded a contextConfig, so
    // reaching here with an error means we have nothing to show.
    if (userProfileError)
      return (
        <Center flex={1} padding={48} width={'100%'}>
          <AsyncError
            error={userProfileError}
            variant={'page'}
            onRetry={() => handleRefreshWorkspaceProfile()}
          />
        </Center>
      );
    return <NotFound />;
  }

  return (
    <WorkspaceDetailProvider config={contextConfig}>
      <WorkspaceHeader />
      <WorkspaceContent />
    </WorkspaceDetailProvider>
  );
});

export const MobileWorkspaceDetailPage = memo(() => {
  return <WorkspaceDetailPage mobile={true} />;
});

export default WorkspaceDetailPage;

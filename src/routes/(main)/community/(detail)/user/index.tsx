'use client';

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useParams } from 'react-router';

import { useCommunityWorkspaceProfile } from '@/business/client/hooks/useCommunityWorkspaceProfile';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useMarketAuth, useMarketUserProfile } from '@/layout/AuthProvider/MarketAuth';
import { type MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { resolveWorkspaceCommunityProfileRedirect } from '../workspace/features/resolveWorkspaceProfileEdit';
import { UserDetailProvider } from './features/DetailProvider';
import UserHeader from './features/Header';
import UserContent from './features/UserContent';
import { useUserDetail } from './features/useUserDetail';
import Loading from './loading';

interface UserDetailPageProps {
  mobile?: boolean;
}

const UserDetailPage = memo<UserDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const location = useLocation();
  const username = decodeURIComponent(params.slug ?? '');
  const navigate = useWorkspaceAwareNavigate();
  const { isWorkspaceScope } = useCommunityWorkspaceProfile();

  const { checkAndShowClaimableResources, getCurrentUserInfo, isAuthenticated, openProfileSetup } =
    useMarketAuth();

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { data, isLoading, mutate } = useUserProfile({ username });

  // When inside a workspace scope, /community/user/:slug and /community/org/:slug are not the
  // right surface — redirect to the dedicated workspace community page.
  useEffect(() => {
    const redirectTo = resolveWorkspaceCommunityProfileRedirect({
      isWorkspaceScope,
      pathname: location.pathname,
      search: location.search,
    });
    if (redirectTo) navigate(redirectTo, { replace: true });
  }, [isWorkspaceScope, location.pathname, location.search, navigate]);

  const currentUser = getCurrentUserInfo();
  const { data: currentUserProfile } = useMarketUserProfile(currentUser?.sub);

  const isOwner =
    !isWorkspaceScope &&
    isAuthenticated &&
    !!currentUser &&
    data?.user?.namespace === currentUserProfile?.namespace;

  // Track if we've already checked for claimable resources in this session
  const hasCheckedClaimable = useRef(false);

  useEffect(() => {
    if (isOwner && !hasCheckedClaimable.current) {
      hasCheckedClaimable.current = true;
      checkAndShowClaimableResources(() => {
        mutate();
      });
    }
  }, [isOwner, checkAndShowClaimableResources, mutate]);

  const { handleStatusChange } = useUserDetail({ onMutate: mutate });

  const handleEditProfile = useCallback(
    (onSuccess?: (profile: MarketUserProfile) => void) => {
      const currentUserName = data?.user?.userName || data?.user?.namespace;
      openProfileSetup((profile) => {
        onSuccess?.(profile);

        mutate();

        const newUserName = profile.userName || profile.namespace;
        if (newUserName && newUserName !== currentUserName) {
          navigate(`/community/user/${newUserName}`, { replace: true });
        }
      });
    },
    [data?.user?.userName, data?.user?.namespace, openProfileSetup, navigate, mutate],
  );

  const contextConfig = useMemo(() => {
    if (!data || !data.user) return null;
    const {
      user,
      agents,
      agentGroups,
      forkedAgents,
      forkedAgentGroups,
      favoriteAgents,
      favoriteAgentGroups,
      skills,
      plugins,
    } = data;
    const totalInstalls = agents.reduce((sum, agent) => sum + (agent.installCount || 0), 0);

    return {
      agentCount: agents.length,
      agentGroups: agentGroups || [],
      agents,
      favoriteAgentGroups: favoriteAgentGroups || [],
      favoriteAgents: favoriteAgents || [],
      forkedAgentGroups: forkedAgentGroups || [],
      forkedAgents: forkedAgents || [],
      groupCount: agentGroups?.length || 0,
      isOwner,
      mobile,
      onEditProfile: handleEditProfile,
      onStatusChange: isOwner ? handleStatusChange : undefined,
      plugins: plugins || [],
      skills: skills || [],
      totalInstalls,
      user,
    };
  }, [data, handleEditProfile, handleStatusChange, isOwner, mobile]);

  if (isLoading) return <Loading />;
  if (!contextConfig) return <NotFound />;

  return (
    <UserDetailProvider config={contextConfig}>
      <UserHeader />
      <UserContent />
    </UserDetailProvider>
  );
});

export const MobileUserDetailPage = memo(() => {
  return <UserDetailPage mobile={true} />;
});

export default UserDetailPage;

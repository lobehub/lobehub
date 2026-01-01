'use client';

import { memo, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useMarketAuth, useMarketUserProfile } from '@/layout/AuthProvider/MarketAuth';
import { type MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
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
  const username = decodeURIComponent(params.slug ?? '');
  const navigate = useNavigate();

  const { getCurrentUserInfo, isAuthenticated, openProfileSetup } = useMarketAuth();

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { data, isLoading, mutate } = useUserProfile({ username });

  // Get current user's profile to check ownership by userName
  const currentUser = getCurrentUserInfo();
  const { data: currentUserProfile } = useMarketUserProfile(currentUser?.sub);

  // Check if the current user is viewing their own profile
  const isOwner =
    isAuthenticated && !!currentUser && data?.user?.namespace === currentUserProfile?.namespace;

  const { handleStatusChange } = useUserDetail({ onMutate: mutate });

  // Handle profile edit with navigation on userName change
  const handleEditProfile = useCallback(
    (onSuccess?: (profile: MarketUserProfile) => void) => {
      const currentUserName = data?.user?.userName || data?.user?.namespace;
      openProfileSetup((profile) => {
        // Call the original onSuccess callback if provided
        onSuccess?.(profile);

        // Navigate to new URL if userName changed
        const newUserName = profile.userName || profile.namespace;
        if (newUserName && newUserName !== currentUserName) {
          navigate(`/community/user/${newUserName}`, { replace: true });
        }
      });
    },
    [data?.user?.userName, data?.user?.namespace, openProfileSetup, navigate],
  );

  const contextConfig = useMemo(() => {
    if (!data || !data.user) return null;
    const { user, agents } = data;
    const totalInstalls = agents.reduce((sum, agent) => sum + (agent.installCount || 0), 0);
    return {
      agentCount: agents.length,
      agents,
      isOwner,
      mobile,
      onEditProfile: handleEditProfile,
      onStatusChange: isOwner ? handleStatusChange : undefined,
      totalInstalls,
      user,
    };
  }, [data, isOwner, mobile, handleEditProfile, handleStatusChange]);

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

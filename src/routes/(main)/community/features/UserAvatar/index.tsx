'use client';

import { Avatar, Button, Skeleton } from '@lobehub/ui';
import { UserCircleIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useMarketAuth, useMarketUserProfile } from '@/layout/AuthProvider/MarketAuth';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

/**
 * Check whether the user needs to complete their profile
 * When using trustedClient auto-authorization, the user's meta-related fields will be empty
 */
const checkNeedsProfileSetup = (
  enableMarketTrustedClient: boolean,
  userProfile:
    | {
        avatarUrl: string | null;
        bannerUrl: string | null;
        socialLinks: { github?: string; twitter?: string; website?: string } | null;
      }
    | null
    | undefined,
): boolean => {
  if (!enableMarketTrustedClient) return false;
  if (!userProfile) return true;

  // If the avatarUrl field is empty, the user needs to complete their profile
  const hasAvatarUrl = !!userProfile.avatarUrl;

  return !hasAvatarUrl;
};

const UserAvatar = memo(() => {
  const { t } = useTranslation('discover');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const { isAuthenticated, isLoading, getCurrentUserInfo, signIn } = useMarketAuth();

  const enableMarketTrustedClient = useServerConfigStore(
    serverConfigSelectors.enableMarketTrustedClient,
  );

  const userInfo = getCurrentUserInfo();
  const username = userInfo?.sub;

  // Use SWR to fetch user profile with caching
  const { data: userProfile } = useMarketUserProfile(username);

  // Check whether profile setup is needed
  const needsProfileSetup = checkNeedsProfileSetup(enableMarketTrustedClient, userProfile);

  const handleSignIn = useCallback(async () => {
    setLoading(true);
    try {
      // Unified call to signIn, which shows a confirmation dialog first
      // In trustedClient mode, confirmation opens the ProfileSetupModal
      // In OIDC mode, confirmation triggers the OIDC flow
      await signIn();
    } catch {
      // User cancelled or error occurred
    }
    setLoading(false);
  }, [signIn]);

  const handleAvatarClick = useCallback(() => {
    const profileUserName = userProfile?.userName || userProfile?.namespace;
    if (profileUserName) {
      navigate(`/community/user/${profileUserName}`);
    }
  }, [navigate, userProfile?.userName, userProfile?.namespace]);

  if (isLoading) {
    return <Skeleton.Avatar active shape={'square'} size={28} style={{ borderRadius: 6 }} />;
  }

  // If trustedClient is enabled, skip the "become a creator" button and show the avatar directly
  // Otherwise, show the login button when unauthenticated or profile setup is needed
  if (!enableMarketTrustedClient && (!isAuthenticated || needsProfileSetup)) {
    return (
      <Button
        icon={UserCircleIcon}
        loading={loading}
        type="text"
        style={{
          height: 30,
        }}
        onClick={handleSignIn}
      >
        {t('user.login')}
      </Button>
    );
  }

  // Get avatar from user profile (fetched via SWR with caching)
  const avatarUrl = userProfile?.avatarUrl;

  return (
    <Avatar
      avatar={avatarUrl || userProfile?.userName || username}
      shape={'square'}
      size={28}
      onClick={handleAvatarClick}
    />
  );
});

export default UserAvatar;

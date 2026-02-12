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
 * 检查用户是否需要完善资料
 * 当使用 trustedClient 自动授权时，用户的 meta 相关字段会为空
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

  // 如果 avatarUrl 字段为空，则需要完善资料
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

  // 检查是否需要完善资料
  const needsProfileSetup = checkNeedsProfileSetup(enableMarketTrustedClient, userProfile);

  const handleSignIn = useCallback(async () => {
    setLoading(true);
    try {
      // 统一调用 signIn，会先弹出确认弹窗
      // trustedClient 模式下确认后会弹出 ProfileSetupModal
      // OIDC 模式下确认后会走 OIDC 流程
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

  // 如果启用了 trustedClient，不显示"成为创作者"按钮，直接显示头像
  // 否则，未认证或需要完善资料时，显示登录按钮
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

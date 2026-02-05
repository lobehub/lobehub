'use client';

import { Button } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { socialService } from '@/services/social';
import { useDiscoverStore } from '@/store/discover';

interface FollowButtonProps {
  userId: number;
}

const FollowButton = memo<FollowButtonProps>(({ userId }) => {
  const { t } = useTranslation('discover');
  const { isAuthenticated, signIn, session } = useMarketAuth();
  const [loading, setLoading] = useState(false);

  const useFollowStatus = useDiscoverStore((s) => s.useFollowStatus);
  const follow = useDiscoverStore((s) => s.follow);
  const unfollow = useDiscoverStore((s) => s.unfollow);

  // Set access token for social service
  if (session?.accessToken) {
    socialService.setAccessToken(session.accessToken);
  }

  const { data: followStatus, mutate } = useFollowStatus(userId);
  const isFollowing = followStatus?.isFollowing ?? false;

  const handleClick = async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }

    setLoading(true);
    try {
      if (isFollowing) {
        await unfollow(userId);
      } else {
        await follow(userId);
      }
      await mutate();
    } catch (error) {
      console.error('Follow action failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      loading={loading}
      shape={'round'}
      size={'large'}
      type={isFollowing ? 'default' : 'primary'}
      style={{
        fontWeight: 500,
        minWidth: 120,
      }}
      onClick={handleClick}
    >
      {isFollowing ? t('user.unfollow') : t('user.follow')}
    </Button>
  );
});

export default FollowButton;

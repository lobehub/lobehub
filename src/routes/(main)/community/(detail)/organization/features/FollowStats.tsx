'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDiscoverStore } from '@/store/discover';

import { useOrganizationDetailContext } from './DetailProvider';

const FollowStats = memo(() => {
  const { t } = useTranslation('discover');
  const { user } = useOrganizationDetailContext();

  // Fall back to the static profile counts (sourced from the authoritative
  // `accounts.*_count` columns) whenever the live count is missing or 0, so a
  // not-yet-populated live query never clobbers a real count.
  const useFollowCounts = useDiscoverStore((s) => s.useFollowCounts);
  const { data: followCounts } = useFollowCounts(user.id);

  const followingCount = followCounts?.followingCount || user.followingCount || 0;
  const followersCount = followCounts?.followersCount || user.followersCount || 0;

  return (
    <Flexbox horizontal align={'center'} gap={16}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text style={{ fontWeight: 600 }}>{followingCount}</Text>
        <Text type={'secondary'}>{t('user.following')}</Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text style={{ fontWeight: 600 }}>{followersCount}</Text>
        <Text type={'secondary'}>{t('user.followers')}</Text>
      </Flexbox>
    </Flexbox>
  );
});

export default FollowStats;

'use client';

import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

/**
 * Group Version Review Tag Component
 * Displays "Under Review" tag when the latest version is not validated
 */
const GroupVersionReviewTag = memo(() => {
  const { t } = useTranslation('setting');
  const { gid } = useParams<{ gid: string }>();
  const meta = useAgentGroupStore((s) => agentGroupSelectors.getGroupMeta(gid ?? '')(s));
  const useMarketAgentGroupStatus = useDiscoverStore((s) => s.useMarketAgentGroupStatus);
  const { queryKey } = useMarketAgentGroupStatus(meta?.marketIdentifier);
  const showReviewTag = !!useDiscoverStore(marketSelectors.agentGroupStatus(queryKey))
    ?.latestVersionUnderReview;

  if (!showReviewTag) return null;

  return (
    <Tag color="orange">
      {t('marketPublish.status.underReview', { defaultValue: 'Under Review' })}
    </Tag>
  );
});

GroupVersionReviewTag.displayName = 'GroupVersionReviewTag';

export default GroupVersionReviewTag;

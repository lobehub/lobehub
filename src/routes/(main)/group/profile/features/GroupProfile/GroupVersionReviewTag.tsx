'use client';

import { Tag } from '@lobehub/ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { marketApiService } from '@/services/marketApi';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

interface GroupVersion {
  isLatest: boolean;
  isValidated: boolean;
  status: string;
  updatedAt: string;
  version: string;
  versionNumber: number;
}

/**
 * Group Version Review Tag Component
 * Displays "Under Review" tag when the latest version is not validated
 */
const GroupVersionReviewTag = memo(() => {
  const { t } = useTranslation('setting');
  const [versions, setVersions] = useState<GroupVersion[] | null>(null);
  const [loading, setLoading] = useState(false);

  const meta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta);
  const marketIdentifier = meta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setVersions(null);
      return;
    }

    const fetchGroupVersions = async () => {
      try {
        setLoading(true);
        const groupDetail = await marketApiService.getAgentGroupDetail(marketIdentifier);
        setVersions(groupDetail.versions || null);
      } catch (error) {
        console.error('Failed to fetch group versions:', error);
        setVersions(null);
      } finally {
        setLoading(false);
      }
    };

    fetchGroupVersions();
  }, [marketIdentifier]);

  const showReviewTag = useMemo(() => {
    if (!versions || versions.length === 0) return false;
    // Check the first version (latest version)
    return versions[0].isValidated === false;
  }, [versions]);

  if (loading || !showReviewTag) return null;

  return (
    <Tag bordered={false} color="orange">
      {t('marketPublish.status.underReview', { defaultValue: 'Under Review' })}
    </Tag>
  );
});

GroupVersionReviewTag.displayName = 'GroupVersionReviewTag';

export default GroupVersionReviewTag;

/**
 * Hook to check if the latest version is under review
 * Can be used in other components to check review status
 */
export const useGroupVersionReviewStatus = () => {
  const [isUnderReview, setIsUnderReview] = useState(false);
  const [loading, setLoading] = useState(false);

  const meta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta);
  const marketIdentifier = meta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setIsUnderReview(false);
      return;
    }

    const checkReviewStatus = async () => {
      try {
        setLoading(true);
        const groupDetail = await marketApiService.getAgentGroupDetail(marketIdentifier);
        const versions = groupDetail.versions || [];
        // Check if the first version (latest) is not validated
        setIsUnderReview(versions.length > 0 && versions[0].isValidated === false);
      } catch (error) {
        console.error('Failed to check review status:', error);
        setIsUnderReview(false);
      } finally {
        setLoading(false);
      }
    };

    checkReviewStatus();
  }, [marketIdentifier]);

  return { isUnderReview, loading };
};

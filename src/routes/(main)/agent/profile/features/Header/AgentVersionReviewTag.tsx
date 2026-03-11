'use client';

import { Tag } from '@lobehub/ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

interface AgentVersion {
  isLatest: boolean;
  isValidated: boolean;
  status: string;
  updatedAt: string;
  version: string;
  versionNumber: number;
}

/**
 * Agent Version Review Tag Component
 * Displays "Under Review" tag when the latest version is not validated
 */
const AgentVersionReviewTag = memo(() => {
  const { t } = useTranslation('setting');
  const [versions, setVersions] = useState<AgentVersion[] | null>(null);
  const [loading, setLoading] = useState(false);

  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const marketIdentifier = meta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setVersions(null);
      return;
    }

    const fetchAgentVersions = async () => {
      try {
        setLoading(true);
        const agentDetail = await marketApiService.getAgentDetail(marketIdentifier);
        // @ts-ignore - versions field exists in the response
        setVersions(agentDetail.versions || null);
      } catch (error) {
        console.error('Failed to fetch agent versions:', error);
        setVersions(null);
      } finally {
        setLoading(false);
      }
    };

    fetchAgentVersions();
  }, [marketIdentifier]);

  const showReviewTag = useMemo(() => {
    if (!versions || versions.length === 0) return false;
    // Check the first version (latest version)
    return versions[0].isValidated === false;
  }, [versions]);

  if (loading || !showReviewTag) return null;

  return (
    <Tag bordered={false} color="orange" style={{ marginRight: 8 }}>
      {t('marketPublish.status.underReview', { defaultValue: 'Under Review' })}
    </Tag>
  );
});

AgentVersionReviewTag.displayName = 'AgentVersionReviewTag';

export default AgentVersionReviewTag;

/**
 * Hook to check if the latest version is under review
 * Can be used in other components to check review status
 */
export const useVersionReviewStatus = () => {
  const [isUnderReview, setIsUnderReview] = useState(false);
  const [loading, setLoading] = useState(false);

  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const marketIdentifier = meta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setIsUnderReview(false);
      return;
    }

    const checkReviewStatus = async () => {
      try {
        setLoading(true);
        const agentDetail = await marketApiService.getAgentDetail(marketIdentifier);
        // @ts-ignore - versions field exists in the response
        const versions = agentDetail.versions || [];
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

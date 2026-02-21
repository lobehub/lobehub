'use client';

import { Icon, Tag } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { marketApiService } from '@/services/marketApi';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { type AgentGroupForkSourceResponse } from '@/types/discover';

/**
 * Group Fork Tag Component
 * Displays fork source information if the group is forked from another group
 */
const GroupForkTag = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();
  const [forkSource, setForkSource] = useState<AgentGroupForkSourceResponse['source']>(null);
  const [loading, setLoading] = useState(false);

  const groupMeta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta);
  const marketIdentifier = groupMeta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setForkSource(null);
      return;
    }

    const fetchGroupForkInfo = async () => {
      try {
        setLoading(true);

        // Get fork source info from market using the marketIdentifier
        const forkSourceResponse = await marketApiService.getAgentGroupForkSource(marketIdentifier);

        setForkSource(forkSourceResponse.source);
      } catch (error) {
        console.error('Failed to fetch group fork info:', error);
        setForkSource(null);
      } finally {
        setLoading(false);
      }
    };

    fetchGroupForkInfo();
  }, [marketIdentifier]);

  if (loading || !forkSource) return null;

  const handleClick = () => {
    if (forkSource?.identifier) {
      navigate(`/community/group_agent/${forkSource.identifier}`);
    }
  };

  return (
    <Tag
      bordered={false}
      color="default"
      icon={<Icon icon={GitFork} />}
      style={{ cursor: 'pointer' }}
      title={t('marketPublish.forkFrom.tooltip', {
        agent: forkSource.name,
        defaultValue: `Forked from ${forkSource.name}`,
      })}
      onClick={handleClick}
    >
      {t('marketPublish.forkFrom.label', { defaultValue: 'Forked from' })} {forkSource.name}
    </Tag>
  );
});

GroupForkTag.displayName = 'GroupForkTag';

export default GroupForkTag;

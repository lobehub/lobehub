'use client';

import { Icon, Tag } from '@lobehub/ui';
import { GitFork } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type AgentForkSourceResponse } from '@/types/discover';

/**
 * Agent Fork Tag Component
 * Displays fork source information if the agent is forked from another agent
 */
const AgentForkTag = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();
  const [forkSource, setForkSource] = useState<AgentForkSourceResponse['source']>(null);
  const [loading, setLoading] = useState(false);

  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const marketIdentifier = meta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setForkSource(null);
      return;
    }

    const fetchAgentAndForkInfo = async () => {
      try {
        setLoading(true);

        // Get agent detail to check if it's a fork
        const agentDetail = await marketApiService.getAgentDetail(marketIdentifier);

        // If forkedFromAgentId exists, get fork source info
        if (agentDetail.forkedFromAgentId) {
          const forkSourceResponse = await marketApiService.getAgentForkSource(marketIdentifier);
          console.log('forkSourceResponse', forkSourceResponse);
          setForkSource(forkSourceResponse.source);
        } else {
          setForkSource(null);
        }
      } catch (error) {
        console.error('Failed to fetch agent fork info:', error);
        setForkSource(null);
      } finally {
        setLoading(false);
      }
    };

    fetchAgentAndForkInfo();
  }, [marketIdentifier]);

  if (loading || !forkSource) return null;

  const handleClick = () => {
    if (forkSource?.identifier) {
      navigate(`/community/agent/${forkSource.identifier}`);
    }
  };

  return (
    <Tag
      bordered={false}
      color="default"
      icon={<Icon icon={GitFork} />}
      style={{ cursor: 'pointer', marginRight: 8 }}
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

AgentForkTag.displayName = 'AgentForkTag';

export default AgentForkTag;

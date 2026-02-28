'use client';

import { Tag } from '@lobehub/ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type AgentStatus } from '@/types/discover';

/**
 * Agent Status Tag Component
 * Displays the market status of the agent (published/unpublished/archived/deprecated)
 */
const AgentStatusTag = memo(() => {
  const { t } = useTranslation('setting');
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const marketIdentifier = meta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setStatus(null);
      return;
    }

    const fetchAgentStatus = async () => {
      try {
        setLoading(true);
        const agentDetail = await marketApiService.getAgentDetail(marketIdentifier);
        setStatus(agentDetail.status as AgentStatus | null);
      } catch (error) {
        console.error('Failed to fetch agent status:', error);
        setStatus(null);
      } finally {
        setLoading(false);
      }
    };

    fetchAgentStatus();
  }, [marketIdentifier]);

  const statusConfig = useMemo(() => {
    if (!status) return null;

    const configs = {
      archived: {
        color: 'orange',
        label: t('marketPublish.status.archived', { defaultValue: 'Archived' }),
      },
      deprecated: {
        color: 'red',
        label: t('marketPublish.status.deprecated', { defaultValue: 'Deprecated' }),
      },
      published: {
        color: 'green',
        label: t('marketPublish.status.published', { defaultValue: 'Published' }),
      },
      unpublished: {
        color: 'default',
        label: t('marketPublish.status.unpublished', { defaultValue: 'Unpublished' }),
      },
    };

    return configs[status];
  }, [status, t]);

  if (loading || !statusConfig) return null;

  return (
    <Tag bordered={false} color={statusConfig.color} style={{ marginRight: 8 }}>
      {statusConfig.label}
    </Tag>
  );
});

AgentStatusTag.displayName = 'AgentStatusTag';

export default AgentStatusTag;

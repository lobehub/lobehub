'use client';

import { Tag } from '@lobehub/ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { type AgentStatus } from '@/types/discover';

/**
 * Group Status Tag Component
 * Displays the market status of the agent group
 */
const GroupStatusTag = memo(() => {
  const { t } = useTranslation('setting');
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const meta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta);
  const marketIdentifier = meta?.marketIdentifier;

  useEffect(() => {
    if (!marketIdentifier) {
      setStatus(null);
      return;
    }

    const fetchGroupStatus = async () => {
      try {
        setLoading(true);
        // TODO: Use getAgentGroupDetail when available
        // For now, groups might not have a separate detail endpoint
        // This is a placeholder - adjust based on actual API
        setStatus('published'); // Temporary: assume published if has identifier
      } catch (error) {
        console.error('Failed to fetch group status:', error);
        setStatus(null);
      } finally {
        setLoading(false);
      }
    };

    fetchGroupStatus();
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
    <Tag bordered={false} color={statusConfig.color}>
      {statusConfig.label}
    </Tag>
  );
});

GroupStatusTag.displayName = 'GroupStatusTag';

export default GroupStatusTag;

'use client';

import { Tag } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentMarketTags } from './useAgentMarketTags';

/**
 * Agent Status Tag Component
 * Displays the market status of the agent (published/unpublished/archived/deprecated).
 * Shares the header's one Market status read with the fork and review tags.
 */
const AgentStatusTag = memo(() => {
  const { t } = useTranslation('setting');
  const { status } = useAgentMarketTags();

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

  if (!statusConfig) return null;

  return (
    <Tag color={statusConfig.color} style={{ marginRight: 8 }}>
      {statusConfig.label}
    </Tag>
  );
});

AgentStatusTag.displayName = 'AgentStatusTag';

export default AgentStatusTag;

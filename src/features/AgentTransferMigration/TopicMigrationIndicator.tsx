'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { memo } from 'react';

import { useTopicMigrationPending } from './MigrationBanner';

interface TopicMigrationIndicatorProps {
  agentId?: string;
  topicId: string;
}

/**
 * Tiny spinner next to a sidebar topic whose history is still migrating after
 * an agent transfer. The topic stays listed (hiding it would read as data
 * loss); opening it jumps it to the front of the backfill queue.
 */
const TopicMigrationIndicator = memo<TopicMigrationIndicatorProps>(({ agentId, topicId }) => {
  const { topicPending } = useTopicMigrationPending(agentId, topicId);

  if (!topicPending) return null;

  return <Icon spin color={cssVar.colorTextQuaternary} icon={Loader2} size={12} />;
});

TopicMigrationIndicator.displayName = 'TopicMigrationIndicator';

export default TopicMigrationIndicator;

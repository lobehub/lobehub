'use client';

import { Spin } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import { useTopicMigrationPending } from './MigrationBanner';
import type { MigrationTarget } from './useAgentTransferJob';

interface TopicMigrationIndicatorProps extends MigrationTarget {
  topicId: string;
}

/**
 * Tiny spinner next to a sidebar topic whose history is still migrating after
 * a transfer or a copy. The topic stays listed (hiding it would read as data
 * loss); opening it jumps it to the front of the backfill queue.
 */
const TopicMigrationIndicator = memo<TopicMigrationIndicatorProps>(
  ({ agentId, groupId, topicId }) => {
    const { topicPending } = useTopicMigrationPending({ agentId, groupId }, topicId);

    if (!topicPending) return null;

    return <Spin size={12} style={{ color: cssVar.colorTextQuaternary }} />;
  },
);

TopicMigrationIndicator.displayName = 'TopicMigrationIndicator';

export default TopicMigrationIndicator;

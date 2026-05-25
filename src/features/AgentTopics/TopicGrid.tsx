'use client';

import { createStaticStyles, responsive } from 'antd-style';
import { memo } from 'react';

import type { ChatTopic } from '@/types/topic';

import TopicCard from './TopicCard';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;

    ${responsive.md} {
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    }
  `,
}));

interface TopicGridProps {
  agentId: string;
  topics: ChatTopic[];
}

const TopicGrid = memo<TopicGridProps>(({ topics, agentId }) => {
  return (
    <div className={styles.grid}>
      {topics.map((topic) => (
        <TopicCard agentId={agentId} key={topic.id} topic={topic} />
      ))}
    </div>
  );
});

TopicGrid.displayName = 'AgentTopicsGrid';

export default TopicGrid;

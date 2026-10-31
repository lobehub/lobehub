'use client';

import type { GroupedTopic } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import TopicCard from './TopicCard';
import type { GroupBy } from './types';
import { getProjectGroupTitle, getTimeGroupTitle } from './utils';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
      [media.md]: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
    },
    gap: '12px',
    width: '100%',
    minWidth: '0',
  },
  groupTitle: {
    marginBlockStart: '8px',
    paddingBlockEnd: '4px',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
});

interface TopicGridProps {
  agentId: string;
  groupBy: GroupBy;
  groups: GroupedTopic[];
  showGroupTitles: boolean;
}

const TopicGrid = memo<TopicGridProps>(({ groups, agentId, showGroupTitles, groupBy }) => {
  const { t } = useTranslation('topic');

  return (
    <Flexbox gap={12}>
      {groups.map((group) => {
        if (group.children.length === 0) return null;
        const title =
          groupBy === 'byProject'
            ? getProjectGroupTitle(group, t)
            : group.title || getTimeGroupTitle(group.id, t);
        return (
          <Fragment key={group.id}>
            {showGroupTitles && (
              <Text as={'div'} className={stylex.props(styles.groupTitle).className}>
                {title}
              </Text>
            )}
            <div {...stylex.props(styles.grid)}>
              {group.children.map((topic) => (
                <TopicCard agentId={agentId} key={topic.id} topic={topic} />
              ))}
            </div>
          </Fragment>
        );
      })}
    </Flexbox>
  );
});

TopicGrid.displayName = 'AgentTopicManagerGrid';

export default TopicGrid;

'use client';

import type { GroupedTopic } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, responsive } from 'antd-style';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import TopicCard from './TopicCard';
import type { GroupBy } from './types';
import { getProjectGroupTitle, getTimeGroupTitle } from './utils';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;

    /*
      min(280px, 100%) lets columns shrink below 280px when the available
      width itself is narrower (e.g. agent sidebar expanded), so the layout
      keeps wrapping instead of overflowing horizontally.
    */
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
    gap: 12px;

    width: 100%;
    min-width: 0;

    ${responsive.md} {
      grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
    }
  `,
  groupTitle: css`
    margin-block-start: 8px;
    padding-block-end: 4px;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

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
            ? getProjectGroupTitle(group.id, group.title, t)
            : group.title || getTimeGroupTitle(group.id, t);
        return (
          <Fragment key={group.id}>
            {showGroupTitles && (
              <Text as={'div'} className={styles.groupTitle}>
                {title}
              </Text>
            )}
            <div className={styles.grid}>
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

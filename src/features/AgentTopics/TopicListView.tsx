'use client';

import type { GroupedTopic } from '@lobechat/types';
import { Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Checkbox } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderIcon, Star } from 'lucide-react';
import { Fragment, memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useActivityTime } from '@/hooks/useActivityTime';
import type { ChatTopic } from '@/types/topic';

import StatusDot from './StatusDot';
import { useTopicsViewStore } from './store';
import type { GroupBy } from './types';
import { getProjectGroupTitle, getProjectLabel, getTimeGroupTitle } from './utils';

const styles = createStaticStyles(({ css }) => ({
  cell: css`
    overflow: hidden;
    min-width: 0;
  `,
  groupBar: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    display: grid;
    grid-template-columns: 24px 20px minmax(0, 1fr) 120px 100px 80px 100px;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.04em;

    background: ${cssVar.colorFillQuaternary};
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 24px 20px minmax(0, 1fr) 120px 100px 80px 100px;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    transition: background 0.12s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:last-child {
      border-block-end: none;
    }
  `,
  rowSelected: css`
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
  sub: css`
    overflow: hidden;
    margin-block-start: 2px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface TopicListViewProps {
  agentId: string;
  groupBy: GroupBy;
  groups: GroupedTopic[];
  showGroupTitles: boolean;
}

interface RowProps {
  agentId: string;
  topic: ChatTopic;
}

const Row = memo<RowProps>(({ topic, agentId }) => {
  const { t } = useTranslation('topic');
  const navigate = useNavigate();

  const selectMode = useTopicsViewStore((s) => s.selectMode);
  const selected = useTopicsViewStore((s) => s.selectedIds.includes(topic.id));
  const toggleSelected = useTopicsViewStore((s) => s.toggleSelected);
  const toggleSelectMode = useTopicsViewStore((s) => s.toggleSelectMode);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (selectMode || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        toggleSelected(topic.id);
        return;
      }
      navigate(SESSION_CHAT_TOPIC_URL(agentId, topic.id));
    },
    [selectMode, topic.id, agentId, toggleSelected, navigate],
  );

  const handleCheckboxChange = useCallback(() => {
    if (!selectMode) toggleSelectMode();
    toggleSelected(topic.id);
  }, [selectMode, topic.id, toggleSelected, toggleSelectMode]);

  const status = topic.status ?? 'active';
  const projectLabel = getProjectLabel(topic);
  const updatedAt = useActivityTime(topic.updatedAt);

  return (
    <div
      className={[styles.row, selected && styles.rowSelected].filter(Boolean).join(' ')}
      onClick={handleClick}
    >
      <Checkbox
        checked={selected}
        onChange={handleCheckboxChange}
        onClick={(e) => e.stopPropagation()}
      />
      <Flexbox align={'center'} justify={'center'}>
        {topic.favorite && <Icon icon={Star} size={13} style={{ color: cssVar.colorWarning }} />}
      </Flexbox>
      <div className={styles.cell}>
        <Text className={styles.title} fontSize={13} weight={500}>
          {topic.title || t('defaultTitle')}
        </Text>
        {topic.historySummary && (
          <Text className={styles.sub} fontSize={11} type={'secondary'}>
            {topic.historySummary}
          </Text>
        )}
      </div>
      <div className={styles.cell}>
        {projectLabel ? (
          <Tag bordered={false} icon={<Icon icon={FolderIcon} size={11} />} size={'small'}>
            {projectLabel}
          </Tag>
        ) : (
          <Text fontSize={12} type={'secondary'}>
            —
          </Text>
        )}
      </div>
      <StatusDot status={status} />
      <Text fontSize={12} type={'secondary'}>
        {topic.trigger ?? 'chat'}
      </Text>
      <Text fontSize={12} style={{ color: cssVar.colorTextQuaternary }} title={updatedAt.title}>
        {updatedAt.text}
      </Text>
    </div>
  );
});

Row.displayName = 'AgentTopicsRow';

const TopicListView = memo<TopicListViewProps>(({ groups, agentId, showGroupTitles, groupBy }) => {
  const { t } = useTranslation('topic');

  return (
    <div className={styles.list}>
      <div className={styles.header}>
        <span />
        <span />
        <span>{t('management.columns.title')}</span>
        <span>{t('management.columns.project')}</span>
        <span>{t('management.columns.status')}</span>
        <span>{t('management.columns.trigger')}</span>
        <span>{t('management.columns.updated')}</span>
      </div>
      {groups.map((group) => {
        if (group.children.length === 0) return null;
        const title =
          groupBy === 'byProject'
            ? getProjectGroupTitle(group.id, group.title, t)
            : group.title || getTimeGroupTitle(group.id, t);
        return (
          <Fragment key={group.id}>
            {showGroupTitles && <div className={styles.groupBar}>{title}</div>}
            {group.children.map((topic) => (
              <Row agentId={agentId} key={topic.id} topic={topic} />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
});

TopicListView.displayName = 'AgentTopicsListView';

export default TopicListView;

'use client';

import type { GroupedTopic } from '@lobechat/types';
import { ActionIcon, Checkbox, DropdownMenu, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderIcon, MoreHorizontal, Star } from 'lucide-react';
import { Fragment, memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useTopicItemDropdownMenu } from '@/routes/(main)/agent/_layout/Sidebar/Topic/List/Item/useDropdownMenu';
import type { ChatTopic } from '@/types/topic';

import StatusDot from './StatusDot';
import { useTopicsViewStore } from './store';
import type { GroupBy, TriggerFilter } from './types';
import { getProjectGroupTitle, getProjectLabel, getTimeGroupTitle } from './utils';

const KNOWN_TRIGGERS: readonly TriggerFilter[] = ['chat', 'api', 'task', 'eval'];

const styles = createStaticStyles(({ css }) => ({
  cell: css`
    overflow: hidden;
    min-width: 0;
  `,
  checkboxBox: css`
    border-color: ${cssVar.colorBorder};
  `,
  groupBar: css`
    display: flex;
    gap: 6px;
    align-items: baseline;

    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  groupCount: css`
    font-size: 11px;
    font-weight: 400;
    color: ${cssVar.colorTextQuaternary};
  `,
  header: css`
    position: sticky;
    z-index: 2;
    inset-block-start: 0;

    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 120px 100px 80px 100px 32px;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    /* opaque so scrolled rows don't bleed through */
    background: ${cssVar.colorBgElevated};
  `,
  headerCellEnd: css`
    text-align: end;
  `,
  list: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 120px 100px 80px 100px 32px;
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

  const { dropdownMenu } = useTopicItemDropdownMenu({
    fav: topic.favorite,
    id: topic.id,
    status: topic.status,
    title: topic.title,
  });

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
  const rawTrigger = topic.trigger ?? 'chat';
  const triggerKey: TriggerFilter = (KNOWN_TRIGGERS as readonly string[]).includes(rawTrigger)
    ? (rawTrigger as TriggerFilter)
    : 'chat';
  const triggerLabel = t(`management.filters.trigger.${triggerKey}` as any) as string;

  return (
    <div
      className={[styles.row, selected && styles.rowSelected].filter(Boolean).join(' ')}
      onClick={handleClick}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          classNames={{ checkbox: styles.checkboxBox }}
          size={18}
          onChange={handleCheckboxChange}
        />
      </div>
      <div className={styles.cell}>
        <Flexbox horizontal align={'center'} gap={6}>
          {topic.favorite && (
            <Icon icon={Star} size={12} style={{ color: cssVar.colorWarning, flexShrink: 0 }} />
          )}
          <Text className={styles.title} fontSize={13} weight={500}>
            {topic.title || t('defaultTitle')}
          </Text>
        </Flexbox>
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
        {triggerLabel}
      </Text>
      <Text
        fontSize={12}
        style={{ color: cssVar.colorTextQuaternary, textAlign: 'end' }}
        title={updatedAt.title}
      >
        {updatedAt.text}
      </Text>
      <DropdownMenu items={dropdownMenu}>
        <ActionIcon icon={MoreHorizontal} size={'small'} onClick={(e) => e.stopPropagation()} />
      </DropdownMenu>
    </div>
  );
});

Row.displayName = 'AgentTopicManagerRow';

const TopicListView = memo<TopicListViewProps>(({ groups, agentId, showGroupTitles, groupBy }) => {
  const { t } = useTranslation('topic');

  const selectedIds = useTopicsViewStore((s) => s.selectedIds);
  const selectMode = useTopicsViewStore((s) => s.selectMode);
  const selectAll = useTopicsViewStore((s) => s.selectAll);
  const clearSelected = useTopicsViewStore((s) => s.clearSelected);
  const toggleSelectMode = useTopicsViewStore((s) => s.toggleSelectMode);

  const allIds = groups.flatMap((g) => g.children.map((c) => c.id));
  const selectedSet = new Set(selectedIds);
  const selectedInListCount = allIds.reduce((acc, id) => acc + (selectedSet.has(id) ? 1 : 0), 0);
  const allSelected = allIds.length > 0 && selectedInListCount === allIds.length;
  const someSelected = selectedInListCount > 0 && !allSelected;

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelected();
    } else {
      if (!selectMode) toggleSelectMode();
      selectAll(allIds);
    }
  };

  return (
    <div className={styles.list}>
      <div className={styles.header}>
        <Checkbox
          checked={allSelected}
          classNames={{ checkbox: styles.checkboxBox }}
          indeterminate={someSelected}
          size={18}
          onChange={handleSelectAll}
        />
        <span>{t('management.columns.title')}</span>
        <span>{t('management.columns.project')}</span>
        <span>{t('management.columns.status')}</span>
        <span>{t('management.columns.trigger')}</span>
        <span className={styles.headerCellEnd}>{t('management.columns.updated')}</span>
        <span />
      </div>
      {groups.map((group) => {
        if (group.children.length === 0) return null;
        const title =
          groupBy === 'byProject'
            ? getProjectGroupTitle(group.id, group.title, t)
            : group.title || getTimeGroupTitle(group.id, t);
        return (
          <Fragment key={group.id}>
            {showGroupTitles && (
              <div className={styles.groupBar}>
                <span>{title}</span>
                <span className={styles.groupCount}>{group.children.length}</span>
              </div>
            )}
            {group.children.map((topic) => (
              <Row agentId={agentId} key={topic.id} topic={topic} />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
});

TopicListView.displayName = 'AgentTopicManagerListView';

export default TopicListView;

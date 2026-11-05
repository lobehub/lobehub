'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { GroupedTopic } from '@lobechat/types';
import { ActionIcon, Checkbox, DropdownMenu, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderIcon, MoreHorizontal, Pin } from 'lucide-react';
import { Fragment, memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlatformIcon } from '@/features/AgentChannel/const';
import { useTopicItemDropdownMenu } from '@/features/AgentSidebar/Topic/List/Item/useDropdownMenu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActivityTime } from '@/hooks/useActivityTime';
import type { ChatTopic } from '@/types/topic';

import StatusDot from './StatusDot';
import { useTopicsViewStore } from './store';
import type { GroupBy, TriggerFilter } from './types';
import { getProjectGroupTitle, getProjectLabel, getTimeGroupTitle } from './utils';

const KNOWN_TRIGGERS: readonly TriggerFilter[] = ['chat', 'api', 'task', 'eval'];

const styles = stylex.create({
  cell: { overflow: 'hidden', minWidth: '0' },
  checkboxBox: { borderColor: cssVar.colorBorder },
  groupBar: {
    display: 'flex',
    gap: '6px',
    alignItems: 'baseline',
    paddingBlock: '8px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorSplit,
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  groupCount: { fontSize: '11px', fontWeight: 400, color: cssVar.colorTextQuaternary },
  header: {
    position: 'sticky',
    zIndex: 2,
    insetBlockStart: '0',
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) 120px 100px 80px 100px 32px',
    gap: '12px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorSplit,
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  headerCellEnd: { textAlign: 'end' },
  list: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  row: {
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) 120px 100px 80px 100px 32px',
    gap: '12px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorSplit,
    transition: 'background 0.12s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowSelected: {
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorPrimaryBgHover },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  sub: {
    overflow: 'hidden',
    marginBlockStart: '2px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

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
  const navigate = useWorkspaceAwareNavigate();

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
      navigate(AGENT_CHAT_TOPIC_URL(agentId, topic.id));
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
  // Bot source platform icon (same identity mark as the sidebar topic item).
  const botPlatform = topic.metadata?.bot?.platform;
  const BotPlatformIcon = botPlatform ? getPlatformIcon(botPlatform) : undefined;

  return (
    <div
      className={[
        stylex.props(styles.row).className,
        stylex.props(selected && styles.rowSelected).className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          classNames={{ checkbox: stylex.props(styles.checkboxBox).className }}
          size={18}
          onChange={handleCheckboxChange}
        />
      </div>
      <div {...stylex.props(styles.cell)}>
        <Flexbox horizontal align={'center'} gap={6}>
          {topic.favorite && (
            <Icon icon={Pin} size={12} style={{ color: cssVar.colorTextTertiary, flexShrink: 0 }} />
          )}
          {BotPlatformIcon && (
            <BotPlatformIcon
              color={cssVar.colorTextDescription}
              size={13}
              style={{ flexShrink: 0 }}
            />
          )}
          <Text className={stylex.props(styles.title).className} fontSize={13} weight={500}>
            {topic.title || t('defaultTitle')}
          </Text>
        </Flexbox>
        {topic.historySummary && (
          <Text className={stylex.props(styles.sub).className} fontSize={11} type={'secondary'}>
            {topic.historySummary}
          </Text>
        )}
      </div>
      <div {...stylex.props(styles.cell)}>
        {projectLabel ? (
          <Tag icon={<Icon icon={FolderIcon} size={11} />} size={'small'}>
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
    <div {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.header)}>
        <Checkbox
          checked={allSelected}
          classNames={{ checkbox: stylex.props(styles.checkboxBox).className }}
          indeterminate={someSelected}
          size={18}
          onChange={handleSelectAll}
        />
        <span>{t('management.columns.title')}</span>
        <span>{t('management.columns.project')}</span>
        <span>{t('management.columns.status')}</span>
        <span>{t('management.columns.trigger')}</span>
        <span {...stylex.props(styles.headerCellEnd)}>{t('management.columns.updated')}</span>
        <span />
      </div>
      {groups.map((group) => {
        if (group.children.length === 0) return null;
        const title =
          groupBy === 'byProject'
            ? getProjectGroupTitle(group, t)
            : group.title || getTimeGroupTitle(group.id, t);
        return (
          <Fragment key={group.id}>
            {showGroupTitles && (
              <div {...stylex.props(styles.groupBar)}>
                <span>{title}</span>
                <span {...stylex.props(styles.groupCount)}>{group.children.length}</span>
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

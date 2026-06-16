'use client';

import { formatElapsedClockTime } from '@lobechat/utils';
import { Avatar, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import { createTaskModal } from '@/features/AgentTasks/CreateTaskModal';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import StatusDot from '@/features/AgentTopicManager/StatusDot';
import { NavPanelPortal } from '@/features/NavPanel';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { type ChatTopicStatus } from '@/types/topic';

import RowsSwitcher from './RowsSwitcher';
import { useFleetStore } from './store';
import { type FleetColumn } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    padding-block: 24px;
    padding-inline: 16px;

    font-size: 13px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
  item: css`
    cursor: pointer;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

/** Live elapsed clock since `startedAt`, re-rendering once per second. */
const useElapsedClock = (startedAt: number | undefined) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt ? formatElapsedClockTime(now - startedAt) : null;
};

interface RunningStatusProps {
  agentId: string;
  status: ChatTopicStatus | undefined;
  topicId: string | null;
}

/**
 * Running indicator: the same spinning ring used across topic rows, paired with
 * a live elapsed-time readout (replaces the static "running" label so the row
 * conveys how long the task has been working). The elapsed baseline is the
 * running operation's start time (same selector the sidebar topic row uses),
 * not the topic's createdAt. Falls back to the shared StatusDot when no running
 * operation is loaded for this context.
 */
const RunningStatus = memo<RunningStatusProps>(({ agentId, status, topicId }) => {
  const { isDarkMode } = useTheme();
  const startedAt = useChatStore(
    operationSelectors.getAgentRuntimeStartTimeByContext({ agentId, topicId }),
  );
  const elapsed = useElapsedClock(startedAt);

  if (!elapsed) return <StatusDot status={status} />;

  const ringColor = isDarkMode
    ? cssVar.colorWarningBorder
    : `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`;

  return (
    <Flexbox horizontal align={'center'} gap={6} style={{ flex: 'none' }}>
      <RingLoadingIcon ringColor={ringColor} size={10} style={{ color: cssVar.colorWarning }} />
      <span
        style={{
          color: cssVar.colorTextSecondary,
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {elapsed}
      </span>
    </Flexbox>
  );
});

RunningStatus.displayName = 'FleetRunningStatus';

interface SidebarTaskItemProps {
  column: FleetColumn;
  onActivate: (column: FleetColumn) => void;
  status: ChatTopicStatus | undefined;
}

const SidebarTaskItem = memo<SidebarTaskItemProps>(({ column, status, onActivate }) => {
  const meta = useAgentDisplayMeta(column.agentId);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.item}
      gap={10}
      paddingBlock={8}
      paddingInline={10}
      title={column.fallbackTitle}
      onClick={() => onActivate(column)}
    >
      <Avatar
        emojiScaleWithBackground
        avatar={meta?.avatar}
        background={meta?.backgroundColor}
        shape={'square'}
        size={28}
      />
      <Flexbox flex={1} gap={2} style={{ overflow: 'hidden' }}>
        <Text ellipsis style={{ fontSize: 13, fontWeight: 500 }}>
          {column.fallbackTitle}
        </Text>
        <Flexbox horizontal align={'center'} gap={6} style={{ overflow: 'hidden' }}>
          <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'}>
            {meta?.title}
          </Text>
          <RunningStatus agentId={column.agentId} status={status} topicId={column.topicId} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

SidebarTaskItem.displayName = 'FleetSidebarTaskItem';

interface RunningTaskSidebarProps {
  columns: FleetColumn[];
  statusByColumnKey: Record<string, ChatTopicStatus | undefined>;
}

/**
 * Fleet's left navigation. Portals into the global NavPanel so the running-topic
 * list *replaces* the standard nav rail while the Fleet view is active. The
 * top bar (`SideBarHeaderLayout`) carries the back-to-home action and open-column
 * count; the body leads with a "create task" action above the running-topic
 * list. Clicking an item opens (or re-opens) its column.
 */
const RunningTaskSidebar = memo<RunningTaskSidebarProps>(({ columns, statusByColumnKey }) => {
  const { t } = useTranslation('electron');
  const addColumn = useFleetStore((s) => s.addColumn);

  const handleActivate = useCallback(
    (column: FleetColumn) => {
      addColumn(column);
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-fleet-col="${CSS.escape(column.key)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
      });
    },
    [addColumn],
  );

  const handleCreateTask = useCallback(() => {
    createTaskModal({ showInlineToggle: false });
  }, []);

  const header = (
    <SideBarHeaderLayout
      backTo={'/'}
      right={<RowsSwitcher />}
      showTogglePanelButton={false}
      left={
        <Flexbox horizontal align={'center'} gap={8}>
          {t('fleet.runningBoard')}
          {columns.length > 0 && <Tag style={{ margin: 0 }}>{columns.length}</Tag>}
        </Flexbox>
      }
    />
  );

  const body = (
    <Flexbox gap={2} paddingBlock={'8px 12px'} paddingInline={8}>
      <Button block icon={PlusIcon} onClick={handleCreateTask}>
        {t('fleet.createTask')}
      </Button>
      {columns.length === 0 ? (
        <div className={styles.empty}>{t('fleet.noRunningTasks')}</div>
      ) : (
        columns.map((column) => (
          <SidebarTaskItem
            column={column}
            key={column.key}
            status={statusByColumnKey[column.key]}
            onActivate={handleActivate}
          />
        ))
      )}
    </Flexbox>
  );

  return (
    <NavPanelPortal navKey={'fleet'}>
      <SideBarLayout body={body} header={header} />
    </NavPanelPortal>
  );
});

RunningTaskSidebar.displayName = 'FleetRunningTaskSidebar';

export default RunningTaskSidebar;

'use client';

import { formatElapsedClockTime } from '@lobechat/utils';
import { ActionIcon, Avatar, Flexbox, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
import { ListXIcon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
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

import { getIdleColumnKeys } from './idleColumns';
import RowsSwitcher from './RowsSwitcher';
import { getFleetSidebarStatus } from './runningStatus';
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
  const context = useMemo(() => ({ agentId, topicId }), [agentId, topicId]);
  const startedAt = useChatStore(
    operationSelectors.getVisibleAgentRuntimeStartTimeByContext(context),
  );
  const isRuntimeRunning = useChatStore(operationSelectors.isAgentRuntimeRunningByContext(context));
  const elapsed = useElapsedClock(startedAt);
  const sidebarStatus = getFleetSidebarStatus({
    isRuntimeRunning,
    status,
    visibleStartedAt: startedAt,
  });

  if (!elapsed) return <StatusDot status={sidebarStatus} />;

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

/** Placeholder row matching `SidebarTaskItem`'s layout while the list loads. */
const SidebarTaskSkeleton = memo(() => (
  <Flexbox horizontal align={'center'} gap={10} paddingBlock={8} paddingInline={10}>
    <Skeleton.Avatar active shape={'square'} size={28} />
    <Flexbox flex={1} gap={6} style={{ overflow: 'hidden' }}>
      <Skeleton.Button active style={{ height: 13, minWidth: 0, width: '70%' }} />
      <Skeleton.Button active style={{ height: 12, minWidth: 0, width: '45%' }} />
    </Flexbox>
  </Flexbox>
));

SidebarTaskSkeleton.displayName = 'FleetSidebarTaskSkeleton';

interface CloseIdleColumnsButtonProps {
  isStatusLoading?: boolean;
  statusByColumnKey: Record<string, ChatTopicStatus | undefined>;
}

/**
 * Board-level action: close every open column that isn't actively running in one
 * click. Idle is derived from the board's own columns (store) against the live
 * running set, so columns whose task finished/paused get cleared while running
 * ones stay. Disabled while the running-status query loads because an empty
 * status map would otherwise make every persisted column look idle.
 */
const CloseIdleColumnsButton = memo<CloseIdleColumnsButtonProps>(
  ({ isStatusLoading, statusByColumnKey }) => {
    const { t } = useTranslation('electron');
    const boardColumns = useFleetStore((s) => s.columns);
    const removeColumns = useFleetStore((s) => s.removeColumns);

    const idleKeys = useMemo(
      () =>
        getIdleColumnKeys({
          columns: boardColumns,
          isStatusLoading,
          statusByColumnKey,
        }),
      [boardColumns, isStatusLoading, statusByColumnKey],
    );

    if (boardColumns.length === 0) return null;

    return (
      <ActionIcon
        disabled={idleKeys.length === 0}
        icon={ListXIcon}
        size={'small'}
        title={
          idleKeys.length > 0
            ? t('fleet.closeIdleColumnsCount', { count: idleKeys.length })
            : t('fleet.closeIdleColumns')
        }
        onClick={() => removeColumns(idleKeys)}
      />
    );
  },
);

CloseIdleColumnsButton.displayName = 'FleetCloseIdleColumnsButton';

interface RunningTaskSidebarProps {
  columns: FleetColumn[];
  /** First-load fetch failure — shown as a failed+Reload state, not fake "no tasks". */
  error?: unknown;
  isLoading?: boolean;
  onReload?: () => void;
  statusByColumnKey: Record<string, ChatTopicStatus | undefined>;
}

/**
 * Fleet's left navigation. Portals into the global NavPanel so the running-topic
 * list *replaces* the standard nav rail while the Fleet view is active. The
 * top bar (`SideBarHeaderLayout`) carries the back-to-home action and open-column
 * count; the body leads with a "create task" action above the running-topic
 * list. Clicking an item opens (or re-opens) its column.
 */
const RunningTaskSidebar = memo<RunningTaskSidebarProps>(
  ({ columns, error, isLoading, onReload, statusByColumnKey }) => {
    const { t } = useTranslation('electron');
    const addColumn = useFleetStore((s) => s.addColumn);

    const handleActivate = useCallback(
      (column: FleetColumn) => {
        addColumn(column);
        // Double rAF so the query runs after React paints the (re-)added column —
        // a single frame can fire before the commit and find nothing to scroll to.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document
              .querySelector(`[data-fleet-col="${CSS.escape(column.key)}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
          });
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
        showTogglePanelButton={false}
        left={
          <Flexbox horizontal align={'center'} gap={8}>
            {t('fleet.runningBoard')}
            {columns.length > 0 && <Tag style={{ margin: 0 }}>{columns.length}</Tag>}
          </Flexbox>
        }
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            <CloseIdleColumnsButton
              isStatusLoading={isLoading || !!error}
              statusByColumnKey={statusByColumnKey}
            />
            <RowsSwitcher />
          </Flexbox>
        }
      />
    );

    const body = (
      <Flexbox gap={2} paddingBlock={'8px 12px'} paddingInline={8}>
        <Button block icon={PlusIcon} onClick={handleCreateTask}>
          {t('fleet.createTask')}
        </Button>
        {error && columns.length === 0 ? (
          // A failed poll must read as a failure with Reload, never as the fake
          // "no running tasks" empty.
          <AsyncError error={error} variant={'inline'} onRetry={onReload} />
        ) : isLoading && columns.length === 0 ? (
          Array.from({ length: 3 }).map((_, index) => <SidebarTaskSkeleton key={index} />)
        ) : columns.length === 0 ? (
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
  },
);

RunningTaskSidebar.displayName = 'FleetRunningTaskSidebar';

export default RunningTaskSidebar;

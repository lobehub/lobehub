'use client';

import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { createTaskModal } from '@/features/AgentTasks/CreateTaskModal';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import StatusDot from '@/features/AgentTopicManager/StatusDot';
import { NavPanelPortal } from '@/features/NavPanel';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { type ChatTopicStatus } from '@/types/topic';

import { useFleetStore } from './store';
import { type FleetColumn } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
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
          <StatusDot status={status ?? 'running'} />
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
 * top bar (`SideBarHeaderLayout`) carries the back-to-home action; the body
 * offers a "create task" entry plus the running-topic list. Clicking an item
 * opens (or re-opens) its column on the board.
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
      left={t('fleet.runningTasks')}
      showTogglePanelButton={false}
      right={
        <Flexbox horizontal align={'center'} gap={6}>
          <ActionIcon
            icon={PlusIcon}
            size={'small'}
            title={t('fleet.createTask')}
            onClick={handleCreateTask}
          />
          <span className={styles.count}>{columns.length}</span>
        </Flexbox>
      }
    />
  );

  const body =
    columns.length === 0 ? (
      <div className={styles.empty}>{t('fleet.noRunningTasks')}</div>
    ) : (
      <Flexbox gap={2} paddingBlock={'4px 12px'} paddingInline={8}>
        {columns.map((column) => (
          <SidebarTaskItem
            column={column}
            key={column.key}
            status={statusByColumnKey[column.key]}
            onActivate={handleActivate}
          />
        ))}
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

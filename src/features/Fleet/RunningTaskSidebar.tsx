'use client';

import { type TaskItem } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { NavPanelPortal } from '@/features/NavPanel';
import BackButton from '@/features/NavPanel/components/BackButton';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import { resolveStatusTone } from './status';
import StatusBadge from './StatusBadge';
import { useFleetStore } from './store';
import { type FleetColumn } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    margin-inline-start: auto;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  empty: css`
    padding-block: 32px;
    padding-inline: 16px;

    font-size: 13px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
  header: css`
    flex: none;
    height: 44px;
    padding-inline: 12px;
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
  task: TaskItem | undefined;
}

const SidebarTaskItem = memo<SidebarTaskItemProps>(({ column, task, onActivate }) => {
  const meta = useAgentDisplayMeta(column.agentId);
  const tone = resolveStatusTone(task?.status, false);

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
          <StatusBadge size={6} tone={tone} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

SidebarTaskItem.displayName = 'FleetSidebarTaskItem';

interface RunningTaskSidebarProps {
  columns: FleetColumn[];
  taskByColumnKey: Record<string, TaskItem>;
}

/**
 * Fleet's left navigation. Portals into the global NavPanel so the running-task
 * list *replaces* the standard nav rail while the Fleet view is active. Clicking
 * an item opens (or re-opens) its column on the board and scrolls it into view.
 */
const RunningTaskSidebar = memo<RunningTaskSidebarProps>(({ columns, taskByColumnKey }) => {
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

  const header = (
    <Flexbox horizontal align={'center'} className={styles.header} gap={6}>
      <BackButton title={t('fleet.backToHome')} to={'/'} />
      <Text style={{ fontSize: 14, fontWeight: 600 }}>{t('fleet.runningTasks')}</Text>
      <span className={styles.count}>{columns.length}</span>
    </Flexbox>
  );

  const body =
    columns.length === 0 ? (
      <div className={styles.empty}>{t('fleet.noRunningTasks')}</div>
    ) : (
      <Flexbox gap={2} paddingBlock={'0 12px'} paddingInline={8}>
        {columns.map((column) => (
          <SidebarTaskItem
            column={column}
            key={column.key}
            task={taskByColumnKey[column.key]}
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

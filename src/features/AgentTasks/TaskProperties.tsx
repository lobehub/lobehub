import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Dropdown, type MenuProps } from 'antd';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDot,
  MinusCircle,
  SignalHigh,
  SignalLow,
  SignalMedium,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from './style';

type TaskStatus = 'backlog' | 'running' | 'paused' | 'completed' | 'canceled' | 'failed';

interface StatusMeta {
  color: string;
  icon: LucideIcon;
  labelKey: string;
}

const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: { color: cssVar.colorTextQuaternary, icon: CircleDashed, labelKey: 'status.backlog' },
  canceled: { color: cssVar.colorTextQuaternary, icon: XCircle, labelKey: 'status.canceled' },
  completed: { color: cssVar.colorSuccess, icon: CheckCircle2, labelKey: 'status.completed' },
  failed: { color: cssVar.colorError, icon: AlertCircle, labelKey: 'status.failed' },
  paused: { color: cssVar.colorWarning, icon: CircleDot, labelKey: 'status.paused' },
  running: { color: cssVar.colorPrimary, icon: Circle, labelKey: 'status.running' },
};

interface PriorityMeta {
  icon: LucideIcon;
  labelKey: string;
}

const PRIORITY_META: Record<number, PriorityMeta> = {
  0: { icon: MinusCircle, labelKey: 'priority.none' },
  1: { icon: AlertCircle, labelKey: 'priority.urgent' },
  2: { icon: SignalHigh, labelKey: 'priority.high' },
  3: { icon: SignalMedium, labelKey: 'priority.normal' },
  4: { icon: SignalLow, labelKey: 'priority.low' },
};

const TaskProperties = memo(() => {
  const { t } = useTranslation('chat');
  const [collapsed, setCollapsed] = useState(false);

  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const priority = useTaskStore(taskDetailSelectors.activeTaskPriority);

  const updateTask = useTaskStore((s) => s.updateTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const completeTask = useTaskStore((s) => s.completeTask);
  const resumeTask = useTaskStore((s) => s.resumeTask);

  const handleStatusChange = useCallback(
    async (next: TaskStatus) => {
      if (!taskId || next === status) return;
      switch (next) {
        case 'backlog': {
          await resumeTask(taskId);
          break;
        }
        case 'canceled': {
          await cancelTask(taskId);
          break;
        }
        case 'completed': {
          await completeTask(taskId);
          break;
        }
        // 'running' → Run Task button; 'paused' → Pause button; 'failed' → system
        // No default
      }
    },
    [taskId, status, cancelTask, completeTask, resumeTask],
  );

  const handlePriorityChange = useCallback(
    async (next: number) => {
      if (!taskId || next === priority) return;
      await updateTask(taskId, { priority: next });
    },
    [taskId, priority, updateTask],
  );

  // 'running'/'paused' → via action buttons; 'failed' → system only
  const userSelectableStatuses: TaskStatus[] = ['backlog', 'completed', 'canceled'];

  const statusItems: MenuProps['items'] = userSelectableStatuses.map((key) => {
    const meta = STATUS_META[key];
    return {
      icon: <Icon icon={meta.icon} size={16} style={{ color: meta.color }} />,
      key,
      label: t(`taskDetail.${meta.labelKey}` as never),
      onClick: () => handleStatusChange(key),
    };
  });

  const priorityItems: MenuProps['items'] = Object.keys(PRIORITY_META).map((key) => {
    const num = Number(key);
    const meta = PRIORITY_META[num];
    return {
      icon: <Icon icon={meta.icon} size={16} style={{ color: cssVar.colorTextSecondary }} />,
      key,
      label: t(`taskDetail.${meta.labelKey}` as never),
      onClick: () => handlePriorityChange(num),
    };
  });

  const statusMeta = status ? STATUS_META[status] : STATUS_META.backlog;
  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META[0];

  return (
    <Flexbox className={styles.propertiesPanel} gap={0}>
      <Flexbox
        horizontal
        align="center"
        className={styles.propertiesHeader}
        gap={4}
        justify="space-between"
      >
        <Text style={{ color: cssVar.colorTextSecondary, fontSize: cssVar.fontSizeSM }}>
          {t('taskDetail.properties')}
        </Text>
        <ActionIcon
          icon={collapsed ? ChevronRight : ChevronDown}
          size="small"
          onClick={() => setCollapsed(!collapsed)}
        />
      </Flexbox>

      {!collapsed && (
        <Flexbox gap={0}>
          {/* Status */}
          <Dropdown menu={{ items: statusItems }} trigger={['click']}>
            <Flexbox horizontal align="center" className={styles.propertyRow} gap={10}>
              <Icon icon={statusMeta.icon} size={16} style={{ color: statusMeta.color }} />
              <Text>{t(`taskDetail.${statusMeta.labelKey}` as never)}</Text>
            </Flexbox>
          </Dropdown>

          {/* Priority */}
          <Dropdown menu={{ items: priorityItems }} trigger={['click']}>
            <Flexbox horizontal align="center" className={styles.propertyRow} gap={10}>
              <Icon
                icon={priorityMeta.icon}
                size={16}
                style={{ color: cssVar.colorTextSecondary }}
              />
              <Text>{t(`taskDetail.${priorityMeta.labelKey}` as never)}</Text>
            </Flexbox>
          </Dropdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default TaskProperties;

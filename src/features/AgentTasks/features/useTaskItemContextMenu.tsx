import { KeyEnum } from '@lobechat/const/hotkeys';
import type { TaskStatus } from '@lobechat/types';
import {
  closeContextMenu,
  combineKeys,
  copyToClipboard,
  Flexbox,
  type GenericItemType,
  Hotkey,
  Icon,
} from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import {
  BarChart3Icon,
  CheckIcon,
  CircleDashedIcon,
  CopyIcon,
  LinkIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useTaskStore } from '@/store/task';

import { PRIORITY_META } from './TaskPriorityTag';
import { STATUS_META, USER_SELECTABLE_STATUSES } from './TaskStatusTag';

const PRIORITY_LEVELS = [0, 1, 2, 3, 4];

interface TaskItemContextMenu {
  items: GenericItemType[];
  onContextMenu: () => void;
}

interface TaskContextMenuTarget {
  identifier: string;
  priority?: number | null;
  status: string;
}

const renderCheck = () => <Icon color={cssVar.colorTextSecondary} icon={CheckIcon} size={14} />;

const renderExtra = (shortcut: string, isCurrent: boolean) =>
  isCurrent ? (
    <Flexbox horizontal align={'center'} gap={6}>
      {renderCheck()}
      {shortcut}
    </Flexbox>
  ) : (
    shortcut
  );

export const useTaskItemContextMenu = (task: TaskContextMenuTarget): TaskItemContextMenu => {
  const { t } = useTranslation(['chat', 'common']);
  const { modal, message } = App.useApp();
  const appOrigin = useAppOrigin();

  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const updateTask = useTaskStore((s) => s.updateTask);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const currentStatus = task.status as TaskStatus;
  const currentPriority = task.priority ?? 0;

  const triggerDelete = useCallback(() => {
    modal.confirm({
      centered: true,
      content: t('taskDetail.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.deleteConfirm.ok'),
      onOk: async () => {
        await deleteTask(task.identifier);
      },
      title: t('taskDetail.deleteConfirm.title'),
      type: 'error',
    });
  }, [modal, t, deleteTask, task.identifier]);

  const items = useMemo<GenericItemType[]>(() => {
    const statusChildren = USER_SELECTABLE_STATUSES.map((status, index) => {
      const meta = STATUS_META[status];
      const isCurrent = status === currentStatus;
      return {
        extra: renderExtra(String(index + 1), isCurrent),
        icon: <Icon color={meta.color} icon={meta.icon} />,
        key: `status-${status}`,
        label: t(`taskDetail.status.${status}`, { defaultValue: meta.label }),
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          if (status === currentStatus) return;
          void updateTaskStatus(task.identifier, status);
        },
      } as GenericItemType;
    });

    const priorityChildren = PRIORITY_LEVELS.map((level, index) => {
      const meta = PRIORITY_META[level];
      const PriorityIcon = meta.icon;
      const isUrgent = level === 1;
      const isCurrent = level === currentPriority;
      return {
        extra: renderExtra(String(index + 1), isCurrent),
        icon: (
          <PriorityIcon color={isUrgent ? cssVar.orange : cssVar.colorTextDescription} size={16} />
        ),
        key: `priority-${level}`,
        label: t(`taskDetail.${meta.labelKey}`, { defaultValue: '' }),
        onClick: async ({ domEvent }) => {
          domEvent.stopPropagation();
          if (level === currentPriority) return;
          await updateTask(task.identifier, { priority: level });
          await refreshTaskList();
        },
      } as GenericItemType;
    });

    const taskUrl = `${appOrigin}/task/${task.identifier}`;

    return [
      {
        children: statusChildren,
        icon: <Icon icon={CircleDashedIcon} />,
        key: 'status',
        label: t('taskList.contextMenu.status'),
      },
      {
        children: priorityChildren,
        icon: <Icon icon={BarChart3Icon} />,
        key: 'priority',
        label: t('taskList.contextMenu.priority'),
      },
      { type: 'divider' },
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: async ({ domEvent }) => {
          domEvent.stopPropagation();
          await copyToClipboard(task.identifier);
          message.success(t('taskList.contextMenu.copyIdSuccess'));
        },
      },
      {
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async ({ domEvent }) => {
          domEvent.stopPropagation();
          await copyToClipboard(taskUrl);
          message.success(t('taskList.contextMenu.copyLinkSuccess'));
        },
      },
      { type: 'divider' },
      {
        danger: true,
        extra: (
          <Hotkey keys={combineKeys([KeyEnum.Mod, KeyEnum.Backspace])} variant={'borderless'} />
        ),
        icon: <Icon icon={Trash2Icon} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          triggerDelete();
        },
      },
    ];
  }, [
    task.identifier,
    currentStatus,
    currentPriority,
    appOrigin,
    t,
    message,
    updateTaskStatus,
    updateTask,
    refreshTaskList,
    triggerDelete,
  ]);

  const cleanupRef = useRef<(() => void) | null>(null);

  const onContextMenu = useCallback(() => {
    cleanupRef.current?.();

    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler, true);
      window.removeEventListener('pointerdown', pointerHandler, true);
      window.removeEventListener('contextmenu', contextHandler, true);
      cleanupRef.current = null;
    };

    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cleanup();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu();
        cleanup();
        triggerDelete();
        return;
      }

      const num = Number.parseInt(event.key, 10);
      if (Number.isNaN(num)) return;
      const idx = num - 1;
      if (idx < 0 || idx >= USER_SELECTABLE_STATUSES.length) return;

      event.preventDefault();
      event.stopPropagation();

      const nextStatus = USER_SELECTABLE_STATUSES[idx];
      if (nextStatus !== currentStatus) {
        void updateTaskStatus(task.identifier, nextStatus);
      }
      closeContextMenu();
      cleanup();
    };

    const pointerHandler = () => {
      cleanup();
    };

    const contextHandler = () => {
      cleanup();
    };

    document.addEventListener('keydown', keyHandler, true);
    window.addEventListener('pointerdown', pointerHandler, true);
    window.addEventListener('contextmenu', contextHandler, true);

    cleanupRef.current = cleanup;
  }, [task.identifier, currentStatus, updateTaskStatus, triggerDelete]);

  useEffect(() => () => cleanupRef.current?.(), []);

  return { items, onContextMenu };
};

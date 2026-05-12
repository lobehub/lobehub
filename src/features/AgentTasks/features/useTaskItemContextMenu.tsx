import type { TaskStatus } from '@lobechat/types';
import { closeContextMenu, copyToClipboard, type GenericItemType, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { BarChart3Icon, CircleDashedIcon, CopyIcon, LinkIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useTaskStore } from '@/store/task';

import { renderMenuExtra } from './menuExtra';
import { PRIORITY_META } from './TaskPriorityTag';
import { STATUS_META, USER_SELECTABLE_STATUSES } from './TaskStatusTag';

const PRIORITY_LEVELS = [0, 1, 2, 3, 4];
const SUBMENU_MARKER = 'data-task-submenu';

interface TaskItemContextMenu {
  items: GenericItemType[];
  onContextMenu: () => void;
}

export interface TaskContextMenuTarget {
  identifier: string;
  priority?: number | null;
  status: string;
}

export interface TaskContextMenuActions {
  buildItems: (task: TaskContextMenuTarget) => GenericItemType[];
  installKeyboardHandlers: (task: TaskContextMenuTarget) => void;
}

export const useTaskContextMenuActions = (): TaskContextMenuActions => {
  const { t } = useTranslation(['chat', 'common']);
  const { modal, message } = App.useApp();
  const appOrigin = useAppOrigin();

  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const updateTask = useTaskStore((s) => s.updateTask);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  return useMemo<TaskContextMenuActions>(() => {
    const triggerDelete = (identifier: string) => {
      modal.confirm({
        centered: true,
        content: t('taskDetail.deleteConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('taskDetail.deleteConfirm.ok'),
        onOk: async () => {
          await deleteTask(identifier);
        },
        title: t('taskDetail.deleteConfirm.title'),
        type: 'error',
      });
    };

    const buildItems = (task: TaskContextMenuTarget): GenericItemType[] => {
      const currentStatus = task.status as TaskStatus;
      const currentPriority = task.priority ?? 0;

      const statusChildren = USER_SELECTABLE_STATUSES.map((status, index) => {
        const meta = STATUS_META[status];
        const isCurrent = status === currentStatus;
        return {
          extra: renderMenuExtra(String(index + 1), isCurrent),
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
          extra: renderMenuExtra(String(index + 1), isCurrent),
          icon: (
            <PriorityIcon color={isUrgent ? cssVar.orange : cssVar.colorTextSecondary} size={16} />
          ),
          key: `priority-${level}`,
          label: t(`taskDetail.${meta.labelKey}` as never, { defaultValue: meta.label }),
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
          icon: <Icon {...{ [SUBMENU_MARKER]: 'status' }} icon={CircleDashedIcon} />,
          key: 'status',
          label: t('taskList.contextMenu.status'),
        },
        {
          children: priorityChildren,
          icon: <Icon {...{ [SUBMENU_MARKER]: 'priority' }} icon={BarChart3Icon} />,
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
          icon: <Icon icon={Trash2Icon} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            triggerDelete(task.identifier);
          },
        },
      ];
    };

    const installKeyboardHandlers = (task: TaskContextMenuTarget) => {
      cleanupRef.current?.();

      const currentStatus = task.status as TaskStatus;
      const currentPriority = task.priority ?? 0;

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

        const num = Number.parseInt(event.key, 10);
        if (Number.isNaN(num)) return;
        const idx = num - 1;

        // Route 1–N to whichever submenu is currently open. The base-ui
        // SubmenuTrigger sets `data-popup-open` on the trigger button while its
        // submenu is open, and we tag each submenu's icon with `data-task-submenu`
        // so we can identify which one was opened.
        const openMarker = document.querySelector<HTMLElement>(
          `[data-popup-open] [${SUBMENU_MARKER}]`,
        );
        const openSubmenu = openMarker?.getAttribute(SUBMENU_MARKER);
        if (!openSubmenu) return;

        if (openSubmenu === 'priority') {
          if (idx < 0 || idx >= PRIORITY_LEVELS.length) return;
          event.preventDefault();
          event.stopPropagation();
          const nextLevel = PRIORITY_LEVELS[idx];
          if (nextLevel !== currentPriority) {
            void (async () => {
              await updateTask(task.identifier, { priority: nextLevel });
              await refreshTaskList();
            })();
          }
          closeContextMenu();
          cleanup();
          return;
        }

        if (openSubmenu === 'status') {
          if (idx < 0 || idx >= USER_SELECTABLE_STATUSES.length) return;
          event.preventDefault();
          event.stopPropagation();
          const nextStatus = USER_SELECTABLE_STATUSES[idx];
          if (nextStatus !== currentStatus) {
            void updateTaskStatus(task.identifier, nextStatus);
          }
          closeContextMenu();
          cleanup();
        }
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
    };

    return { buildItems, installKeyboardHandlers };
  }, [modal, message, t, appOrigin, updateTaskStatus, updateTask, refreshTaskList, deleteTask]);
};

export const useTaskItemContextMenu = (task: TaskContextMenuTarget): TaskItemContextMenu => {
  const { buildItems, installKeyboardHandlers } = useTaskContextMenuActions();
  const items = useMemo(
    () => buildItems(task),
    [buildItems, task.identifier, task.status, task.priority],
  );
  const onContextMenu = useCallback(
    () => installKeyboardHandlers(task),
    [installKeyboardHandlers, task.identifier, task.status, task.priority],
  );
  return { items, onContextMenu };
};

import type { TaskStatus } from '@lobechat/types';
import { copyToClipboard, type GenericItemType, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { BarChart3Icon, CircleDashedIcon, CopyIcon, LinkIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import { PRIORITY_META } from './TaskPriorityTag';
import { STATUS_META, USER_SELECTABLE_STATUSES } from './TaskStatusTag';

const PRIORITY_LEVELS = [0, 1, 2, 3, 4];

export const useTaskItemContextMenu = (task: TaskListItem): GenericItemType[] => {
  const { t } = useTranslation(['chat', 'common']);
  const { modal, message } = App.useApp();

  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const updateTask = useTaskStore((s) => s.updateTask);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  return useMemo<GenericItemType[]>(() => {
    const currentStatus = task.status as TaskStatus;
    const currentPriority = task.priority ?? 0;

    const statusChildren: GenericItemType[] = USER_SELECTABLE_STATUSES.map((status) => {
      const meta = STATUS_META[status];
      return {
        disabled: status === currentStatus,
        icon: <Icon color={meta.color} icon={meta.icon} />,
        key: `status-${status}`,
        label: t(`taskDetail.status.${status}`, { defaultValue: meta.label }),
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          if (status === currentStatus) return;
          void updateTaskStatus(task.identifier, status);
        },
      };
    });

    const priorityChildren: GenericItemType[] = PRIORITY_LEVELS.map((level) => {
      const meta = PRIORITY_META[level];
      const PriorityIcon = meta.icon;
      const isUrgent = level === 1;
      return {
        disabled: level === currentPriority,
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
      };
    });

    const taskUrl = `${globalThis.location?.origin ?? ''}/agent/${task.assigneeAgentId ?? ''}/tasks/${task.identifier}`;

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
        disabled: !task.assigneeAgentId,
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async ({ domEvent }) => {
          domEvent.stopPropagation();
          if (!task.assigneeAgentId) return;
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
        },
      },
    ];
  }, [
    task.identifier,
    task.status,
    task.priority,
    task.assigneeAgentId,
    t,
    modal,
    message,
    updateTaskStatus,
    updateTask,
    refreshTaskList,
    deleteTask,
  ]);
};

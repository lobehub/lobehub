import { KeyEnum } from '@lobechat/const/hotkeys';
import {
  ActionIcon,
  combineKeys,
  copyToClipboard,
  type DropdownItem,
  DropdownMenu,
  Hotkey,
  Icon,
} from '@lobehub/ui';
import { App } from 'antd';
import { CopyIcon, LinkIcon, MoreHorizontal, Trash } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskDetailHeaderActions = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const { modal, message } = App.useApp();
  const navigate = useNavigate();
  const appOrigin = useAppOrigin();
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const triggerDelete = useCallback(() => {
    if (!taskId) return;
    modal.confirm({
      centered: true,
      content: t('taskDetail.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.deleteConfirm.ok'),
      onOk: async () => {
        await deleteTask(taskId);
        navigate('/tasks');
      },
      title: t('taskDetail.deleteConfirm.title'),
      type: 'error',
    });
  }, [taskId, modal, t, deleteTask, navigate]);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!taskId) return [];

    const taskUrl = `${appOrigin}/task/${taskId}`;

    return [
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: async () => {
          await copyToClipboard(taskId);
          message.success(t('taskList.contextMenu.copyIdSuccess'));
        },
      },
      {
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async () => {
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
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: triggerDelete,
      },
    ];
  }, [taskId, appOrigin, t, message, triggerDelete]);

  if (!taskId) return null;

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default TaskDetailHeaderActions;

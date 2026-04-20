import { ActionIcon, type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { MoreHorizontal, Trash } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskDetailHeaderActions = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!taskId) return [];

    return [
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => {
          modal.confirm({
            centered: true,
            content: t('taskDetail.deleteConfirm.content'),
            okButtonProps: { danger: true },
            okText: t('taskDetail.deleteConfirm.ok'),
            onOk: async () => {
              await deleteTask(taskId);
              if (agentId) navigate(`/agent/${agentId}/tasks`);
            },
            title: t('taskDetail.deleteConfirm.title'),
            type: 'error',
          });
        },
      },
    ];
  }, [taskId, agentId, deleteTask, modal, navigate, t]);

  if (!taskId) return null;

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default TaskDetailHeaderActions;

import { ActionIcon } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskDetailDeleteAction = memo(() => {
  const { t } = useTranslation('chat');
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  if (!taskId) return null;

  return (
    <ActionIcon
      icon={Trash2}
      size="small"
      style={{ color: cssVar.colorTextTertiary }}
      onClick={() => {
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
      }}
    />
  );
});

export default TaskDetailDeleteAction;

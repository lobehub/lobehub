import type { TaskDetailData, TaskDetailSubtask } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import TaskSubtaskProgressTag from '../features/TaskSubtaskProgressTag';
import { styles } from '../shared/style';

const TaskParentBar = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const parent = useTaskStore(taskDetailSelectors.activeTaskParent);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const currentIdentifier = useTaskStore(taskDetailSelectors.activeTaskDetail)?.identifier;

  const [parentSubtasks, setParentSubtasks] = useState<TaskDetailSubtask[]>([]);

  useEffect(() => {
    setParentSubtasks([]);
    if (!parent?.identifier) return;

    taskService
      .getDetail(parent.identifier)
      .then((res) => {
        const detail = res.data as TaskDetailData;
        setParentSubtasks(detail.subtasks ?? []);
      })
      .catch((err) => {
        console.error('[TaskParentBar] Failed to load parent subtasks', err);
      });
  }, [parent?.identifier]);

  if (!parent) return null;

  return (
    <Flexbox horizontal align="center" className={styles.parentBar} gap={8}>
      <Text style={{ color: cssVar.colorTextTertiary }}>{t('taskDetail.subIssueOf')}</Text>
      <Flexbox
        horizontal
        align="center"
        className={styles.parentLink}
        gap={6}
        onClick={() => {
          if (agentId) navigate(`/agent/${agentId}/tasks/${parent.identifier}`);
        }}
      >
        <div className={styles.subtaskCircle} />
        <Text style={{ color: cssVar.colorTextSecondary }}>{parent.identifier}</Text>
        <Text weight="bold">{parent.name}</Text>
      </Flexbox>
      {parentSubtasks.length > 0 && (
        <TaskSubtaskProgressTag
          currentIdentifier={currentIdentifier}
          subtasks={parentSubtasks}
          onSubtaskClick={(identifier) => {
            if (agentId) navigate(`/agent/${agentId}/tasks/${identifier}`);
          }}
        />
      )}
    </Flexbox>
  );
});

export default TaskParentBar;

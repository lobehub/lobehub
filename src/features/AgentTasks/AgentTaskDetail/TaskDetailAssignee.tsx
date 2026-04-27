import type { TaskStatus } from '@lobechat/types';
import { Block, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar, useThemeMode } from 'antd-style';
import { UserCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

const TaskDetailAssignee = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
  const { isDarkMode } = useThemeMode();

  if (!taskId) return null;

  return (
    <AssigneeAgentSelector
      currentAgentId={assigneeAgentId}
      disabled={status === 'running'}
      taskIdentifier={taskId}
    >
      <Tooltip title={assigneeAgentId ? undefined : t('taskList.unassignedHint')}>
        <Block
          clickable
          horizontal
          align="center"
          gap={8}
          paddingBlock={4}
          paddingInline={11}
          style={{ minHeight: 32 }}
          variant={isDarkMode ? 'filled' : 'outlined'}
        >
          {assigneeAgentId ? (
            <>
              <AssigneeAvatar agentId={assigneeAgentId} size={20} />
              <Text weight={500}>{assigneeMeta?.title}</Text>
            </>
          ) : (
            <>
              <Icon color={cssVar.colorTextDescription} icon={UserCircle2} size={18} />
              <Text style={{ color: cssVar.colorTextDescription }} weight={500}>
                {t('taskList.unassigned')}
              </Text>
            </>
          )}
        </Block>
      </Tooltip>
    </AssigneeAgentSelector>
  );
});

export default TaskDetailAssignee;

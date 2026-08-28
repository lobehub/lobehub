import type { TaskStatus } from '@lobechat/types';
import { Block, Icon, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar, useThemeMode } from 'antd-style';
import { UserCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import HeterogeneousTag from '@/features/HeterogeneousTag';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';

const TaskDetailAssignee = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const assigneeUserId = useTaskStore(taskDetailSelectors.activeTaskAssigneeUserId);
  const visibility = useTaskStore(taskDetailSelectors.activeTaskVisibility);
  const createdByUserId = useTaskStore(taskDetailSelectors.activeTaskCreatedByUserId);
  const automationMode = useTaskStore(taskDetailSelectors.activeTaskAutomationMode);
  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
  // An agent assignee wins the display when both ids are set (only external
  // writers can produce that combination — the picker keeps them exclusive).
  const memberMeta = useUserDisplayMeta(assigneeAgentId ? undefined : assigneeUserId);
  // Same source as the home list so the runtime tag stays consistent.
  const assigneeHeterogeneousType = useHomeStore(
    (s) => homeAgentListSelectors.getAgentById(assigneeAgentId ?? '')(s)?.heterogeneousType,
  );
  const { isDarkMode } = useThemeMode();

  if (!taskId) return null;

  const hasAssignee = Boolean(assigneeAgentId || assigneeUserId);

  return (
    <AssigneeAgentSelector
      currentAgentId={assigneeAgentId}
      currentUserId={assigneeUserId}
      disabled={status === 'running'}
      hideMembers={Boolean(automationMode)}
      taskCreatorId={createdByUserId}
      taskIdentifier={taskId}
      taskVisibility={visibility}
    >
      <Tooltip title={hasAssignee ? undefined : t('taskList.unassignedHint')}>
        <Block
          clickable
          horizontal
          align="center"
          gap={8}
          paddingBlock={4}
          paddingInline={11}
          // `flex: none` keeps the chip at its content width so a narrow column
          // wraps the row instead of squeezing the name to one character per
          // line; `maxWidth` + the label's ellipsis then bound a very long name.
          style={{ flex: 'none', maxWidth: '100%', minHeight: 32 }}
          variant={isDarkMode ? 'filled' : 'outlined'}
        >
          {assigneeAgentId ? (
            <>
              <AssigneeAvatar agentId={assigneeAgentId} size={20} />
              <Text ellipsis weight={500}>
                {assigneeMeta?.title}
              </Text>
              <HeterogeneousTag type={assigneeHeterogeneousType} />
            </>
          ) : assigneeUserId ? (
            <>
              <AssigneeUserAvatar size={20} userId={assigneeUserId} />
              <Text ellipsis weight={500}>
                {memberMeta?.title}
              </Text>
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

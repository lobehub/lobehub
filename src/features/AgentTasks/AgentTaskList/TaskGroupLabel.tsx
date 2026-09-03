import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CalendarClock, HeartPulse, UserRound } from 'lucide-react';
import { memo } from 'react';

import AssigneeAvatar from '../features/AssigneeAvatar';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import PriorityHighIcon from '../features/icons/PriorityHighIcon';
import PriorityLowIcon from '../features/icons/PriorityLowIcon';
import PriorityMediumIcon from '../features/icons/PriorityMediumIcon';
import PriorityNoneIcon from '../features/icons/PriorityNoneIcon';
import PriorityUrgentIcon from '../features/icons/PriorityUrgentIcon';
import TaskStatusIcon from '../features/TaskStatusIcon';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';
import type { TaskGroupMeta } from './listViewOptions';

const PRIORITY_ICON_MAP = {
  0: PriorityNoneIcon,
  1: PriorityUrgentIcon,
  2: PriorityHighIcon,
  3: PriorityMediumIcon,
  4: PriorityLowIcon,
} as const;

const AssigneeLabel = memo<{ agentId: string }>(({ agentId }) => {
  const displayMeta = useAgentDisplayMeta(agentId);
  return <>{displayMeta?.title}</>;
});

const AssigneeUserLabel = memo<{ userId: string }>(({ userId }) => {
  const displayMeta = useUserDisplayMeta(userId);
  return <>{displayMeta?.title}</>;
});

const TaskGroupPrefix = ({ group }: { group: TaskGroupMeta }) => {
  if (group.groupBy === 'assignee') {
    if (group.assigneeId) return <AssigneeAvatar agentId={group.assigneeId} size={18} />;
    return <Icon icon={UserRound} size={14} />;
  }

  if (group.groupBy === 'member') {
    if (group.assigneeUserId) return <AssigneeUserAvatar size={18} userId={group.assigneeUserId} />;
    return <Icon icon={UserRound} size={14} />;
  }

  if (group.groupBy === 'priority') {
    const priority = group.priority ?? 0;
    const PriorityIcon =
      PRIORITY_ICON_MAP[priority as keyof typeof PRIORITY_ICON_MAP] || PriorityNoneIcon;
    return (
      <PriorityIcon
        color={priority === 1 ? cssVar.orange : cssVar.colorTextDescription}
        size={16}
      />
    );
  }

  if (group.groupBy === 'automationMode') {
    return (
      <Icon
        color={cssVar.colorTextDescription}
        icon={group.automationMode === 'heartbeat' ? HeartPulse : CalendarClock}
        size={16}
      />
    );
  }

  if (group.groupBy === 'status') {
    return <TaskStatusIcon size={16} status={group.status ?? 'backlog'} />;
  }

  return null;
};

interface TaskGroupLabelProps {
  group: TaskGroupMeta;
}

const TaskGroupLabel = memo<TaskGroupLabelProps>(({ group }) => (
  <Flexbox horizontal align={'center'} flex={'none'} gap={6} style={{ overflow: 'hidden' }}>
    <TaskGroupPrefix group={group} />
    <Text ellipsis weight={500}>
      {group.groupBy === 'assignee' && group.assigneeId ? (
        <AssigneeLabel agentId={group.assigneeId} />
      ) : group.groupBy === 'member' && group.assigneeUserId ? (
        <AssigneeUserLabel userId={group.assigneeUserId} />
      ) : (
        group.label
      )}
    </Text>
  </Flexbox>
));

export default TaskGroupLabel;

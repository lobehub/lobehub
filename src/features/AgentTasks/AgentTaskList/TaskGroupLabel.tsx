import { cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { CalendarClock, FolderXIcon, HeartPulse, TagIcon, UserRound } from 'lucide-react';
import { memo } from 'react';

import TaskLabelDot from '@/features/TaskLabels/TaskLabelDot';
import { useDensityTokens } from '@/styles/density';

import AssigneeAvatar from '../features/AssigneeAvatar';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import PriorityHighIcon from '../features/icons/PriorityHighIcon';
import PriorityLowIcon from '../features/icons/PriorityLowIcon';
import PriorityMediumIcon from '../features/icons/PriorityMediumIcon';
import PriorityNoneIcon from '../features/icons/PriorityNoneIcon';
import PriorityUrgentIcon from '../features/icons/PriorityUrgentIcon';
import TaskProjectChip from '../features/TaskProjectChip';
import TaskStatusIcon from '../features/TaskStatusIcon';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';
import type { TaskGroupMeta } from './listViewOptions';
import { isTaskLabelGroupBy } from './listViewOptions';

/**
 * Statuses whose group header keeps its status color. Like Linear, headers are
 * otherwise neutral so a stack of them stays quiet; color is left for groups
 * that need the user (a failed run, a task waiting for review).
 */
const ATTENTION_STATUSES = new Set<TaskGroupMeta['status']>(['failed', 'paused']);

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

const TaskGroupPrefix = ({ group, listHeader }: { group: TaskGroupMeta; listHeader?: boolean }) => {
  if (isTaskLabelGroupBy(group.groupBy)) {
    if (group.labelId) return <TaskLabelDot color={group.labelColor} size={10} />;
    return <Icon color={cssVar.colorTextDescription} icon={TagIcon} size={14} />;
  }

  if (group.groupBy === 'assignee') {
    if (group.assigneeId) return <AssigneeAvatar agentId={group.assigneeId} size={18} />;
    return <Icon icon={UserRound} size={14} />;
  }

  if (group.groupBy === 'member') {
    if (group.assigneeUserId) return <AssigneeUserAvatar size={18} userId={group.assigneeUserId} />;
    return <Icon icon={UserRound} size={14} />;
  }

  // A named project's header is its badge alone — see `TaskGroupLabel`.
  if (group.groupBy === 'project') {
    if (group.projectId) return null;
    return <Icon color={cssVar.colorTextDescription} icon={FolderXIcon} size={14} />;
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
    const status = group.status ?? 'backlog';
    return (
      <TaskStatusIcon
        size={16}
        status={status}
        color={
          listHeader && !ATTENTION_STATUSES.has(status) ? cssVar.colorTextDescription : undefined
        }
      />
    );
  }

  return null;
};

interface TaskGroupLabelProps {
  group: TaskGroupMeta;
  /**
   * Task-list group header styling (like Linear): the title follows the density
   * type scale, which also sets the header height, and status icons are muted.
   * Kanban column headers keep their own sizing and status colors.
   */
  listHeader?: boolean;
}

const TaskGroupLabel = memo<TaskGroupLabelProps>(({ group, listHeader }) => {
  const { fontSize, lineHeight } = useDensityTokens();
  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6} style={{ overflow: 'hidden' }}>
      <TaskGroupPrefix group={group} listHeader={listHeader} />
      {group.groupBy === 'project' && group.projectId ? (
        <TaskProjectChip projectId={group.projectId} />
      ) : (
        <Text
          ellipsis
          fontSize={listHeader ? fontSize : undefined}
          style={listHeader ? { lineHeight: `${lineHeight}px` } : undefined}
          weight={500}
        >
          {group.groupBy === 'assignee' && group.assigneeId ? (
            <AssigneeLabel agentId={group.assigneeId} />
          ) : group.groupBy === 'member' && group.assigneeUserId ? (
            <AssigneeUserLabel userId={group.assigneeUserId} />
          ) : (
            group.label
          )}
        </Text>
      )}
    </Flexbox>
  );
});

export default TaskGroupLabel;

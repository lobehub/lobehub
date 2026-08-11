import type { TaskListItem, TaskStatus } from '../../task';

export interface TaskProjectionFragments {
  assignment: Pick<TaskListItem, 'assigneeAgentId' | 'participants' | 'visibility' | 'workspaceId'>;
  description: Pick<TaskListItem, 'description'>;
  display: Pick<TaskListItem, 'name'>;
  identity: Pick<TaskListItem, 'identifier'>;
  lifecycle: { status: TaskStatus };
}

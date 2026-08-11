import type { TaskDetailData, TaskListItem, TaskParticipant, TaskStatus } from '../../task';
import type { ProjectionRef } from '../base';

export type TaskProjectionParticipant =
  (ProjectionRef<'agent'> & { type: 'agent' }) | (Omit<TaskParticipant, 'type'> & { type: 'user' });

export interface TaskProjectionFragments {
  assignment: Pick<TaskListItem, 'assigneeAgentId' | 'visibility' | 'workspaceId'>;
  description: { description?: string | null };
  detail: Omit<TaskDetailData, 'description' | 'identifier' | 'name' | 'status'>;
  display: { name?: string | null };
  identity: Pick<TaskListItem, 'identifier'>;
  lifecycle: { status: TaskStatus };
  participants: { participants: TaskProjectionParticipant[] };
  row: Omit<
    TaskListItem,
    | 'assigneeAgentId'
    | 'description'
    | 'id'
    | 'identifier'
    | 'name'
    | 'participants'
    | 'status'
    | 'visibility'
    | 'workspaceId'
  >;
}

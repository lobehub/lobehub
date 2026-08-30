import type {
  TaskDetailData,
  TaskItem,
  TaskListItem,
  TaskProjection,
  TaskProjectionParticipant,
  TaskStatus,
} from '@lobechat/types';

import { projectionFragment, type ProjectionObservation } from '../../core/ingest';

const taskStatuses = new Set<TaskStatus>([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
  'scheduled',
]);

const taskStatus = (value: string): TaskStatus | undefined =>
  taskStatuses.has(value as TaskStatus) ? (value as TaskStatus) : undefined;

const taskProjectionParticipant = (
  participant: TaskListItem['participants'][number],
): TaskProjectionParticipant =>
  participant.type === 'agent'
    ? { id: participant.id, kind: 'agent', type: 'agent' }
    : { ...participant, type: 'user' };

export const taskListProjectionRecord = (
  item: TaskItem | TaskListItem,
  observation: ProjectionObservation,
): TaskProjection => {
  const participants = 'participants' in item ? item.participants : undefined;
  const row = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) =>
        ![
          'assigneeAgentId',
          'description',
          'id',
          'identifier',
          'name',
          'participants',
          'status',
          'visibility',
          'workspaceId',
        ].includes(key),
    ),
  );
  const status = taskStatus(item.status);

  return {
    fragments: {
      assignment: projectionFragment(
        {
          assigneeAgentId: item.assigneeAgentId,
          visibility: item.visibility,
          workspaceId: item.workspaceId,
        },
        observation,
      ),
      description: projectionFragment({ description: item.description }, observation),
      display: projectionFragment({ name: item.name }, observation),
      identity: projectionFragment({ identifier: item.identifier }, observation),
      ...(status ? { lifecycle: projectionFragment({ status }, observation) } : {}),
      ...(participants
        ? {
            participants: projectionFragment(
              {
                participants: participants.map(taskProjectionParticipant),
              },
              observation,
            ),
          }
        : {}),
      row: projectionFragment(
        row as NonNullable<TaskProjection['fragments']['row']>['data'],
        observation,
      ),
    },
    id: item.id,
    kind: 'task',
  };
};

export const taskDetailProjectionRecord = (
  detail: TaskDetailData,
  recordId: string,
  observation: ProjectionObservation,
): TaskProjection => {
  const status = taskStatus(detail.status);
  const { description, identifier, name, status: _status, ...detailWithoutOwnedFields } = detail;
  return {
    fragments: {
      description: projectionFragment({ description }, observation),
      detail: projectionFragment(detailWithoutOwnedFields, observation),
      display: projectionFragment({ name }, observation),
      identity: projectionFragment({ identifier }, observation),
      ...(status ? { lifecycle: projectionFragment({ status }, observation) } : {}),
    },
    id: recordId,
    kind: 'task',
  };
};

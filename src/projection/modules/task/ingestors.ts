import type {
  ProjectionCommit,
  TaskDetailData,
  TaskGroupListIndex,
  TaskItem,
  TaskListIndex,
  TaskListItem,
  TaskListQuerySignature,
  TaskProjection,
  TaskProjectionParticipant,
  TaskStatus,
} from '@lobechat/types';
import { taskGroupListIndexKey, taskListIndexKey } from '@lobechat/types';

import { projectionFragment, type ProjectionObservation } from '../../core/ingest';
import { agentProjectionRecord } from '../agent/ingestors';

export interface TaskGroupProjectionInput {
  hasMore: boolean;
  key: string;
  limit: number;
  offset: number;
  tasks: TaskItem[];
  total: number;
}

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

export const ingestTaskList = (
  items: TaskListItem[],
  total: number,
  signature: TaskListQuerySignature,
  observation: ProjectionObservation,
): ProjectionCommit => {
  const participantAgents = new Map<string, TaskListItem['participants'][number]>();
  for (const item of items) {
    for (const participant of item.participants) {
      if (participant.type === 'agent') participantAgents.set(participant.id, participant);
    }
  }

  return {
    indexes: [
      {
        key: taskListIndexKey(signature.agentKey, signature.visibility),
        refs: items.map(({ id }) => ({ id, kind: 'task' })),
        signature,
        total,
        ...observation,
      } satisfies TaskListIndex,
    ],
    records: [
      ...items.map((item) => taskListProjectionRecord(item, observation)),
      ...Array.from(participantAgents.values(), (agent) =>
        agentProjectionRecord(agent, observation, 'summary'),
      ),
    ],
  };
};

export const ingestTaskGroupList = (
  groups: TaskGroupProjectionInput[],
  signature: TaskListQuerySignature,
  observation: ProjectionObservation,
): ProjectionCommit => {
  const unique = new Map<string, TaskItem>();
  for (const group of groups) for (const task of group.tasks) unique.set(task.id, task);

  return {
    indexes: [
      {
        groups: groups.map(({ tasks, ...group }) => ({
          ...group,
          refs: tasks.map(({ id }) => ({ id, kind: 'task' as const })),
        })),
        key: taskGroupListIndexKey(signature.agentKey, signature.visibility),
        signature,
        ...observation,
      } satisfies TaskGroupListIndex,
    ],
    records: [...unique.values()].map((item) => taskListProjectionRecord(item, observation)),
  };
};

export const ingestTaskDetail = (
  detail: TaskDetailData,
  recordId: string,
  observation: ProjectionObservation,
): ProjectionCommit => ({ records: [taskDetailProjectionRecord(detail, recordId, observation)] });

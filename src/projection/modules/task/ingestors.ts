import type {
  ProjectionCommit,
  TaskDetailData,
  TaskGroupListIndex,
  TaskItem,
  TaskListIndex,
  TaskListItem,
  TaskListQuerySignature,
} from '@lobechat/types';
import { taskGroupListIndexKey, taskListIndexKey } from '@lobechat/types';

import type { ProjectionObservation } from '../../core/ingest';
import { agentProjectionRecord } from '../agent/ingestors';
import { taskDetailProjectionRecord, taskListProjectionRecord } from './records';

export { taskDetailProjectionRecord, taskListProjectionRecord } from './records';

export interface TaskGroupProjectionInput {
  hasMore: boolean;
  key: string;
  limit: number;
  offset: number;
  tasks: TaskItem[];
  total: number;
}

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

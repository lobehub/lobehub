import type { ProjectionFragmentName, TaskListQuerySignature } from '@lobechat/types';
import { taskGroupListIndexKey, taskListIndexKey } from '@lobechat/types';

import { projectionRecordRequest, projectionRefsFromIndex } from '../../views/request';
import type { ProjectionViewContract } from '../../views/types';
import { AGENT_SUMMARY_FRAGMENTS } from '../agent/contracts';
import { findTaskRecordByIdentity } from './selectors';

const TASK_ROW_FRAGMENTS = [
  'assignment',
  'description',
  'display',
  'identity',
  'lifecycle',
  'row',
] as const satisfies readonly ProjectionFragmentName<'task'>[];

export const taskDetailViewContract: ProjectionViewContract<{ id: string }> = {
  key: ({ id }) => `task.detail:${id}`,
  records: (scope, { id }) => [
    projectionRecordRequest(
      'task',
      [findTaskRecordByIdentity(scope, id)?.id ?? id],
      ['description', 'detail', 'display', 'identity', 'lifecycle'],
    ),
  ],
};

export const taskListViewContract: ProjectionViewContract<TaskListQuerySignature> = {
  indexes: ({ agentKey, visibility }) => [taskListIndexKey(agentKey, visibility)],
  key: ({ agentKey, visibility }) => taskListIndexKey(agentKey, visibility),
  records: (scope, params) => {
    const index = scope?.indexes[taskListIndexKey(params.agentKey, params.visibility)];
    const taskIds = projectionRefsFromIndex(index).map((ref) => ref.id);
    const agentIds = taskIds.flatMap(
      (id) =>
        scope?.records.task[id]?.fragments.participants?.data.participants
          .filter((participant) => participant.type === 'agent')
          .map((participant) => participant.id) ?? [],
    );
    return [
      projectionRecordRequest('task', taskIds, [...TASK_ROW_FRAGMENTS, 'participants']),
      projectionRecordRequest('agent', agentIds, AGENT_SUMMARY_FRAGMENTS),
    ];
  },
};

export const taskGroupListViewContract: ProjectionViewContract<TaskListQuerySignature> = {
  indexes: ({ agentKey, visibility }) => [taskGroupListIndexKey(agentKey, visibility)],
  key: ({ agentKey, visibility }) => taskGroupListIndexKey(agentKey, visibility),
  records: (scope, params) => [
    projectionRecordRequest(
      'task',
      projectionRefsFromIndex(
        scope?.indexes[taskGroupListIndexKey(params.agentKey, params.visibility)],
      ).map((ref) => ref.id),
      TASK_ROW_FRAGMENTS,
    ),
  ],
};

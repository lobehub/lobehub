import type {
  ProjectionFragmentName,
  ProjectionIndex,
  ProjectionRecordHydrationRequest,
} from '@lobechat/types';
import { briefNewsIndexKey } from '@lobechat/types';

import type { ProjectionScopeState } from '../../core/initialState';
import { projectionRecordRequest, projectionRefsFromIndex } from '../../views/request';
import type { ProjectionViewContract } from '../../views/types';
import { AGENT_SUMMARY_FRAGMENTS } from '../agent/contracts';

const BRIEF_FRAGMENTS = [
  'actions',
  'content',
  'readState',
  'relations',
  'resolution',
] as const satisfies readonly ProjectionFragmentName<'brief'>[];

export const briefRecordsForIndex = (
  scope: ProjectionScopeState | undefined,
  index: ProjectionIndex | undefined,
): ProjectionRecordHydrationRequest[] => {
  const briefIds = projectionRefsFromIndex(index).map((ref) => ref.id);
  const relations = briefIds.flatMap((id) => {
    const relation = scope?.records.brief[id]?.fragments.relations?.data;
    return relation ? [relation] : [];
  });
  return [
    projectionRecordRequest('brief', briefIds, BRIEF_FRAGMENTS),
    projectionRecordRequest(
      'agent',
      relations.flatMap((item) => (item.agentId ? [item.agentId] : [])),
      AGENT_SUMMARY_FRAGMENTS,
    ),
    projectionRecordRequest(
      'task',
      relations.flatMap((item) => (item.taskId ? [item.taskId] : [])),
      ['display', 'identity', 'lifecycle'],
    ),
  ];
};

export const briefNewsViewContract: ProjectionViewContract<{ day: string }> = {
  indexes: ({ day }) => [briefNewsIndexKey(day)],
  key: ({ day }) => briefNewsIndexKey(day),
  records: (scope, { day }) => briefRecordsForIndex(scope, scope?.indexes[briefNewsIndexKey(day)]),
};

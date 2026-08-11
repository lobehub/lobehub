import type { ProjectionScopeState } from '../../core/initialState';
import { projectionRecordRequest, projectionRefsFromIndex } from '../../views/request';
import type { ProjectionViewContract } from '../../views/types';
import { AGENT_SIDEBAR_FRAGMENTS } from '../agent/contracts';
import { briefRecordsForIndex } from '../brief/contracts';

const HOME_TASK_FRAGMENTS = [
  'assignment',
  'description',
  'display',
  'identity',
  'lifecycle',
  'row',
] as const;

const homeTaskRecords = (
  scope: ProjectionScopeState | undefined,
  indexKey: 'home.scheduledTasks' | 'home.tasks',
) => {
  const taskIds = projectionRefsFromIndex(scope?.indexes[indexKey]).map((ref) => ref.id);
  const agentIds = taskIds.flatMap((id) => {
    const agentId = scope?.records.task[id]?.fragments.assignment?.data.assigneeAgentId;
    return agentId ? [agentId] : [];
  });

  return [
    projectionRecordRequest('task', taskIds, HOME_TASK_FRAGMENTS),
    projectionRecordRequest('agent', agentIds, ['identity']),
  ];
};

export const homeSidebarViewContract: ProjectionViewContract<Record<string, never>> = {
  indexes: () => ['home.sidebar'],
  key: () => 'home.sidebar',
  records: (scope) => {
    const refs = projectionRefsFromIndex(scope?.indexes['home.sidebar']);
    return [
      projectionRecordRequest(
        'agent',
        refs.filter((ref) => ref.kind === 'agent').map((ref) => ref.id),
        AGENT_SIDEBAR_FRAGMENTS,
      ),
      projectionRecordRequest(
        'chatGroup',
        refs.filter((ref) => ref.kind === 'chatGroup').map((ref) => ref.id),
        ['access', 'identity'],
      ),
    ];
  },
};

export const homeRecentTopicsViewContract: ProjectionViewContract<{
  limit: number;
  view: 'mine' | 'team';
}> = {
  indexes: () => ['home.recentTopics'],
  key: ({ limit, view }) => `home.recentTopics:${limit}:${view}`,
  records: (scope, { limit }) => [
    projectionRecordRequest(
      'topic',
      projectionRefsFromIndex(scope?.indexes['home.recentTopics'])
        .slice(0, limit)
        .map((ref) => ref.id),
      ['activity', 'display', 'navigation', 'ownership', 'preview', 'routing'],
    ),
  ],
};

export const homeInboxTopicsViewContract: ProjectionViewContract<Record<string, never>> = {
  indexes: () => ['home.inboxTopics'],
  key: () => 'home.inboxTopics',
  records: (scope) => [
    projectionRecordRequest(
      'topic',
      projectionRefsFromIndex(scope?.indexes['home.inboxTopics']).map((ref) => ref.id),
      [
        'activity',
        'creation',
        'display',
        'ownership',
        'preview',
        'routing',
        'runTiming',
        'status',
        'triggerInfo',
      ],
    ),
  ],
};

export const homeTasksViewContract: ProjectionViewContract<Record<string, never>> = {
  indexes: () => ['home.tasks'],
  key: () => 'home.tasks',
  records: (scope) => homeTaskRecords(scope, 'home.tasks'),
};

export const homeScheduledTasksViewContract: ProjectionViewContract<Record<string, never>> = {
  indexes: () => ['home.scheduledTasks'],
  key: () => 'home.scheduledTasks',
  records: (scope) => homeTaskRecords(scope, 'home.scheduledTasks'),
};

export const homeBriefsViewContract: ProjectionViewContract<Record<string, never>> = {
  indexes: () => ['home.unresolvedBriefs'],
  key: () => 'home.unresolvedBriefs',
  records: (scope) => briefRecordsForIndex(scope, scope?.indexes['home.unresolvedBriefs']),
};

export const homeDailyBriefViewContract: ProjectionViewContract<Record<string, never>> = {
  key: () => 'home.dailyBrief',
  snapshots: () => ['home.dailyBrief'],
};

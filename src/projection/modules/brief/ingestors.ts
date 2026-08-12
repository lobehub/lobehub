import type {
  AgentProjection,
  BriefItem,
  BriefNewsIndex,
  BriefProjection,
  ProjectionCommit,
  ProjectionRecord,
  TaskProjection,
} from '@lobechat/types';
import { briefNewsIndexKey } from '@lobechat/types';

import { projectionFragment, type ProjectionObservation } from '../../core/ingest';
import { agentProjectionRecord } from '../agent/ingestors';

export const briefProjectionRecord = (
  item: BriefItem,
  observation: ProjectionObservation,
): BriefProjection => ({
  fragments: {
    actions: projectionFragment({ actions: item.actions }, observation),
    content: projectionFragment(
      {
        artifacts: item.artifacts,
        createdAt: item.createdAt,
        priority: item.priority,
        summary: item.summary,
        title: item.title,
        type: item.type,
      },
      observation,
    ),
    readState: projectionFragment({ readAt: item.readAt }, observation),
    relations: projectionFragment(
      {
        agentId: item.agentId,
        cronJobId: item.cronJobId,
        taskId: item.taskId,
        topicId: item.topicId,
        userId: item.userId,
      },
      observation,
    ),
    resolution: projectionFragment(
      {
        resolvedAction: item.resolvedAction,
        resolvedAt: item.resolvedAt,
        resolvedComment: item.resolvedComment,
      },
      observation,
    ),
  },
  id: item.id,
  kind: 'brief',
});

const briefAgentRecord = (
  item: BriefItem,
  observation: ProjectionObservation,
): AgentProjection[] =>
  item.agent ? [agentProjectionRecord(item.agent, observation, 'identity')] : [];

const briefTaskRecord = (item: BriefItem, observation: ProjectionObservation): TaskProjection[] => {
  if (!item.taskId) return [];

  const fragments: TaskProjection['fragments'] = {};
  if (item.taskIdentifier) {
    fragments.identity = projectionFragment({ identifier: item.taskIdentifier }, observation);
  }
  if (item.taskName !== undefined) {
    fragments.display = projectionFragment({ name: item.taskName }, observation);
  }
  if (item.taskStatus) {
    fragments.lifecycle = projectionFragment({ status: item.taskStatus }, observation);
  }
  return Object.keys(fragments).length > 0 ? [{ fragments, id: item.taskId, kind: 'task' }] : [];
};

export const ingestBriefNews = (
  day: string,
  hasEarlier: boolean,
  items: BriefItem[],
  observation: ProjectionObservation,
): ProjectionCommit => {
  const records: ProjectionRecord[] = [];
  for (const item of items) {
    records.push(briefProjectionRecord(item, observation));
    records.push(...briefAgentRecord(item, observation));
    records.push(...briefTaskRecord(item, observation));
  }

  return {
    indexes: [
      {
        day,
        hasEarlier,
        key: briefNewsIndexKey(day),
        refs: items.map(({ id }) => ({ id, kind: 'brief' })),
        ...observation,
      } satisfies BriefNewsIndex,
    ],
    records,
  };
};

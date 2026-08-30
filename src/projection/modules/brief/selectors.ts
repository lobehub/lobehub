import type { BriefItem, BriefNewsIndex, BriefProjection } from '@lobechat/types';
import { briefNewsIndexKey } from '@lobechat/types';

import type { ProjectionScopeState } from '../../core/initialState';
import { activeProjectionRecord } from '../../core/record';
import { selectAgentSummary } from '../agent/selectors';

const activeRecord = (record: BriefProjection | undefined): BriefProjection | undefined =>
  activeProjectionRecord(record);

export const selectBriefItem = (
  scope: ProjectionScopeState,
  record: BriefProjection | undefined,
): BriefItem | undefined => {
  const active = activeRecord(record);
  const actions = active?.fragments.actions?.data;
  const content = active?.fragments.content?.data;
  const readState = active?.fragments.readState?.data;
  const relations = active?.fragments.relations?.data;
  const resolution = active?.fragments.resolution?.data;
  if (!active || !actions || !content || !readState || !relations || !resolution) return undefined;
  const agent = relations.agentId
    ? selectAgentSummary(scope.records.agent[relations.agentId])
    : undefined;
  const task = relations.taskId ? scope.records.task[relations.taskId] : undefined;

  return {
    id: active.id,
    ...actions,
    ...content,
    ...readState,
    ...relations,
    ...resolution,
    agent: agent
      ? {
          avatar: typeof agent.avatar === 'string' ? agent.avatar : null,
          backgroundColor: agent.backgroundColor ?? null,
          id: agent.id,
          name: agent.name ?? null,
          title: agent.title ?? null,
        }
      : null,
    taskIdentifier: task?.fragments.identity?.data.identifier,
    taskName: task?.fragments.display?.data.name,
    taskStatus: task?.fragments.lifecycle?.data.status,
  };
};

export const selectBriefNewsIndex = (
  scope: ProjectionScopeState | undefined,
  day: string,
): BriefNewsIndex | undefined => scope?.indexes[briefNewsIndexKey(day)];

export const selectBriefNews = (
  scope: ProjectionScopeState | undefined,
  day: string,
): BriefItem[] | undefined => {
  const index = selectBriefNewsIndex(scope, day);
  if (!scope || !index) return undefined;
  const items: BriefItem[] = [];
  for (const ref of index.refs) {
    const record = scope.records.brief[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const item = selectBriefItem(scope, record);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

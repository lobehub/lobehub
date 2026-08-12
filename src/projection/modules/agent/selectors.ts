import type {
  AgentAvailableIndex,
  AgentDirectoryIndex,
  AgentItem,
  AgentProjection,
  AgentSearchIndex,
  LobeAgentConfig,
  SidebarAgentItem,
} from '@lobechat/types';
import { agentSearchIndexKey } from '@lobechat/types';

import type { ProjectionScopeState } from '../../core/initialState';
import { activeProjectionRecord } from '../../core/record';
import { selectHomeSidebarItem } from '../home/selectors';

export type AgentProjectionView = { id: string } & Partial<AgentItem> & Partial<LobeAgentConfig>;

const activeRecord = (record: AgentProjection | undefined): AgentProjection | undefined =>
  activeProjectionRecord(record);

const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

export const selectAgentProjection = (
  record: AgentProjection | undefined,
): AgentProjectionView | undefined => {
  const active = activeRecord(record);
  const configuration = active?.fragments.configuration?.data;
  if (!active || !configuration) return undefined;

  return withoutUndefined({
    id: active.id,
    ...configuration,
    ...active.fragments.knowledge?.data,
    ...active.fragments.metadata?.data,
    ...active.fragments.identity?.data,
    ...active.fragments.profile?.data,
    ...active.fragments.access?.data,
    ...active.fragments.routing?.data,
    ...active.fragments.runtime?.data,
    ...active.fragments.lifecycle?.data,
  }) as AgentProjectionView;
};

export const selectAgentSummary = (
  record: AgentProjection | undefined,
): AgentProjectionView | undefined => {
  const active = activeRecord(record);
  const identity = active?.fragments.identity?.data;
  if (!active || !identity) return undefined;
  return withoutUndefined({
    id: active.id,
    ...identity,
    ...active.fragments.profile?.data,
    ...active.fragments.access?.data,
    ...active.fragments.runtime?.data,
  }) as AgentProjectionView;
};

export const selectAvailableAgentsIndex = (
  scope: ProjectionScopeState | undefined,
): AgentAvailableIndex | undefined => {
  const index = scope?.indexes['agent.available'];
  return index?.key === 'agent.available' ? index : undefined;
};

export const selectAgentDirectoryIndex = (
  scope: ProjectionScopeState | undefined,
): AgentDirectoryIndex | undefined => {
  const index = scope?.indexes['agent.directory'];
  return index?.key === 'agent.directory' ? index : undefined;
};

export const selectAgentDirectory = (
  scope: ProjectionScopeState | undefined,
): AgentProjectionView[] | undefined => {
  const index = selectAgentDirectoryIndex(scope);
  if (!scope || !index) return undefined;
  const items: AgentProjectionView[] = [];
  for (const ref of index.refs) {
    const record = scope.records.agent[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const item = selectAgentSummary(record);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

export const selectAgentSearchIndex = (
  scope: ProjectionScopeState | undefined,
  keyword: string | undefined,
): AgentSearchIndex | undefined => {
  const index = scope?.indexes[agentSearchIndexKey(keyword)];
  return index?.key.startsWith('agent.search:') ? index : undefined;
};

export const selectAgentSearch = (
  scope: ProjectionScopeState | undefined,
  keyword: string | undefined,
): SidebarAgentItem[] | undefined => {
  const index = selectAgentSearchIndex(scope, keyword);
  if (!scope || !index) return undefined;
  const items: SidebarAgentItem[] = [];
  for (const ref of index.refs) {
    const record =
      ref.kind === 'chatGroup' ? scope.records.chatGroup[ref.id] : scope.records.agent[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const item = selectHomeSidebarItem(scope, ref);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

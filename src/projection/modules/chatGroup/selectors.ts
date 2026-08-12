import type {
  AgentGroupDetail,
  AgentGroupMember,
  ChatGroupItem,
  ChatGroupProjection,
} from '@lobechat/types';

import type { ProjectionScopeState } from '../../core/initialState';
import { activeProjectionRecord } from '../../core/record';
import { selectAgentProjection } from '../agent/selectors';

const activeRecord = (record: ChatGroupProjection | undefined): ChatGroupProjection | undefined =>
  activeProjectionRecord(record);

const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

export const selectChatGroupItem = (
  record: ChatGroupProjection | undefined,
): ChatGroupItem | undefined => {
  const active = activeRecord(record);
  const identity = active?.fragments.identity?.data;
  const access = active?.fragments.access?.data;
  const lifecycle = active?.fragments.lifecycle?.data;
  if (!active || !identity || !access || !lifecycle) return undefined;
  return withoutUndefined({
    id: active.id,
    ...active.fragments.configuration?.data,
    ...identity,
    ...access,
    ...lifecycle,
  }) as ChatGroupItem;
};

export const selectChatGroupDetail = (
  scope: ProjectionScopeState,
  id: string,
): AgentGroupDetail | undefined => {
  const record = scope.records.chatGroup[id];
  const item = selectChatGroupItem(record);
  const active = activeRecord(record);
  const configuration = active?.fragments.configuration?.data;
  const membership = active?.fragments.membership?.data;
  if (!item || !configuration || !membership) return undefined;

  const agents: AgentGroupMember[] = [];
  for (const member of membership.agents) {
    const agent = selectAgentProjection(scope.records.agent[member.id]);
    if (!agent) return undefined;
    agents.push({ ...agent, isSupervisor: member.isSupervisor } as AgentGroupMember);
  }

  return { ...item, agents, supervisorAgentId: membership.supervisorAgentId };
};

export const selectChatGroupList = (
  scope: ProjectionScopeState | undefined,
): ChatGroupItem[] | undefined => {
  const index = scope?.indexes['chatGroup.list'];
  if (!scope || index?.key !== 'chatGroup.list') return undefined;
  const items: ChatGroupItem[] = [];
  for (const ref of index.refs) {
    const item = selectChatGroupItem(scope.records.chatGroup[ref.id]);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

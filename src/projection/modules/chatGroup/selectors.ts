import { DEFAULT_AVATAR } from '@lobechat/const';
import type {
  AgentGroupDetail,
  AgentGroupMember,
  ChatGroupItem,
  ChatGroupProjection,
} from '@lobechat/types';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG, DEFAULT_CHAT_GROUP_META_CONFIG } from '@/const/settings';
import { merge } from '@/utils/merge';

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

const EMPTY_GROUP_AGENTS: AgentGroupMember[] = [];

/**
 * Canonical group view for ChatGroup consumers.
 *
 * A list response only owns summary fragments, so it deliberately exposes an
 * empty member list until the detail Projection has landed. No data is copied
 * into a second store.
 */
export const selectChatGroupView = (
  scope: ProjectionScopeState | undefined,
  id: string,
): AgentGroupDetail | undefined => {
  if (!scope || !id) return undefined;

  const detail = selectChatGroupDetail(scope, id);
  if (detail) return detail;

  const item = selectChatGroupItem(scope.records.chatGroup[id]);
  return item ? ({ ...item, agents: EMPTY_GROUP_AGENTS } as AgentGroupDetail) : undefined;
};

const groupById =
  (id: string) =>
  (scope: ProjectionScopeState | undefined): AgentGroupDetail | undefined =>
    selectChatGroupView(scope, id);

const groupConfig = (groupId: string) => (scope: ProjectionScopeState | undefined) => {
  const group = groupById(groupId)(scope);
  return merge(DEFAULT_CHAT_GROUP_CHAT_CONFIG, group?.config || {});
};

const groupMeta = (groupId: string) => (scope: ProjectionScopeState | undefined) => {
  const group = groupById(groupId)(scope);
  return merge(DEFAULT_CHAT_GROUP_META_CONFIG, {
    avatar: group?.avatar || undefined,
    backgroundColor: group?.backgroundColor || undefined,
    description: group?.description || '',
    marketIdentifier: group?.marketIdentifier || undefined,
    title: group?.title || '',
  });
};

const groupAgents =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): AgentGroupMember[] =>
    groupById(groupId)(scope)?.agents || EMPTY_GROUP_AGENTS;

const groupMembers =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): AgentGroupMember[] =>
    groupAgents(groupId)(scope).filter((agent) => !agent.isSupervisor);

const groupMemberAvatars =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): { avatar: string; background?: string }[] =>
    groupMembers(groupId)(scope).map((agent) => ({
      avatar: agent.avatar || DEFAULT_AVATAR,
      background: agent.backgroundColor || undefined,
    }));

const groupOpeningMessage =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): string | undefined =>
    groupConfig(groupId)(scope)?.openingMessage;

const groupOpeningQuestions =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): string[] =>
    groupConfig(groupId)(scope)?.openingQuestions || [];

const groupAgentCount =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): number =>
    groupAgents(groupId)(scope).length;

const groupMemberCount =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): number =>
    groupMembers(groupId)(scope).length;

const agentByIdFromGroup =
  (groupId: string, agentId: string) =>
  (scope: ProjectionScopeState | undefined): AgentGroupMember | undefined =>
    groupAgents(groupId)(scope).find((agent) => agent.id === agentId);

const groupBySupervisorAgentId =
  (supervisorAgentId: string) =>
  (scope: ProjectionScopeState | undefined): AgentGroupDetail | undefined => {
    if (!scope) return undefined;

    for (const id of Object.keys(scope.records.chatGroup)) {
      const group = selectChatGroupDetail(scope, id);
      if (group?.supervisorAgentId === supervisorAgentId) return group;
    }
    return undefined;
  };

const isGroupNotFoundById =
  (groupId: string) =>
  (scope: ProjectionScopeState | undefined): boolean => {
    const record = groupId ? scope?.records.chatGroup[groupId] : undefined;
    return Boolean(record && !activeProjectionRecord(record));
  };

const getAllGroups = (scope: ProjectionScopeState | undefined): AgentGroupDetail[] => {
  if (!scope) return [];
  return Object.keys(scope.records.chatGroup).flatMap((id) => {
    const group = selectChatGroupView(scope, id);
    return group ? [group] : [];
  });
};

const isGroupsInitialized = (scope: ProjectionScopeState | undefined): boolean =>
  selectChatGroupList(scope) !== undefined;

export const chatGroupProjectionSelectors = {
  getAgentByIdFromGroup: agentByIdFromGroup,
  getAllGroups,
  getGroupAgentCount: groupAgentCount,
  getGroupAgents: groupAgents,
  getGroupById: groupById,
  getGroupBySupervisorAgentId: groupBySupervisorAgentId,
  getGroupConfig: groupConfig,
  getGroupMemberAvatars: groupMemberAvatars,
  getGroupMemberCount: groupMemberCount,
  getGroupMembers: groupMembers,
  getGroupMeta: groupMeta,
  getGroupOpeningMessage: groupOpeningMessage,
  getGroupOpeningQuestions: groupOpeningQuestions,
  isGroupNotFoundById,
  isGroupsInitialized,
};

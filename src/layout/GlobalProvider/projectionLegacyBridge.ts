import type { ChatTopic, ChatTopicsIndex, TaskDetailData } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import type { ProjectionScopeState } from '@/projection/core/initialState';
import { activeProjectionRecord } from '@/projection/core/record';
import { selectAgentProjection, selectAgentSummary } from '@/projection/modules/agent/selectors';
import {
  selectChatTopicListItem,
  selectChatTopicsItems,
} from '@/projection/modules/chat/selectors';
import {
  selectChatGroupDetail,
  selectChatGroupItem,
  selectChatGroupList,
} from '@/projection/modules/chatGroup/selectors';
import { selectHomeBriefs, selectHomeSidebar } from '@/projection/modules/home/selectors';
import {
  selectTaskDetail,
  selectTaskGroupList,
  selectTaskListIndex,
  selectTaskListItem,
} from '@/projection/modules/task/selectors';
import { useProjectionStore } from '@/projection/store';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useBriefStore } from '@/store/brief';
import { useChatStore } from '@/store/chat';
import type { TopicData } from '@/store/chat/slices/topic/initialState';
import { getHomeStoreState } from '@/store/home/store';
import { useTaskStore } from '@/store/task';

let bridgeStarted = false;
let lastScope: string | undefined;

const resetScopedLegacyState = (scopeName: string): void => {
  useAgentStore.setState({
    agentConfigErrorMap: {},
    agentMap: {},
    agentNotFoundMap: {},
    availableAgents: undefined,
  });
  useAgentGroupStore.setState({
    groupMap: {},
    groupNotFoundMap: {},
    groups: [],
    groupsInit: false,
  });
  useChatStore.setState({
    agentTopicsViewMap: {},
    searchTopics: [],
    topicDataMap: {},
  });
  useTaskStore.setState({
    isTaskGroupListInit: false,
    isTaskListInit: false,
    taskDetailMap: {},
    taskGroups: [],
    tasks: [],
    tasksTotal: 0,
  });
  useBriefStore.setState({
    briefs: [],
    briefsScope: undefined,
    isBriefsInit: false,
  });
  getHomeStoreState().internal_syncAgentListProjection(undefined, scopeName);
};

const syncAgents = (scope: ProjectionScopeState): void => {
  const current = useAgentStore.getState();
  const agentMap = { ...current.agentMap };
  const agentNotFoundMap = { ...current.agentNotFoundMap };

  for (const [id, record] of Object.entries(scope.records.agent)) {
    if (!activeProjectionRecord(record)) {
      delete agentMap[id];
      agentNotFoundMap[id] = true;
      continue;
    }

    const agent = selectAgentProjection(record);
    if (agent) agentMap[id] = agent;
    delete agentNotFoundMap[id];
  }

  const availableIndex = scope.indexes['agent.available'];
  const availableAgents =
    availableIndex?.key === 'agent.available'
      ? availableIndex.refs.flatMap((ref) => {
          const item = selectAgentSummary(scope.records.agent[ref.id]);
          if (!item) return [];
          return [
            {
              avatar: item.avatar ?? null,
              backgroundColor: item.backgroundColor ?? null,
              description: item.description ?? null,
              id: item.id,
              name: item.name ?? null,
              title: item.title ?? null,
            },
          ];
        })
      : current.availableAgents;

  if (
    isEqual(current.agentMap, agentMap) &&
    isEqual(current.agentNotFoundMap, agentNotFoundMap) &&
    isEqual(current.availableAgents, availableAgents)
  ) {
    return;
  }
  useAgentStore.setState({ agentMap, agentNotFoundMap, availableAgents });
};

const syncChatGroups = (scope: ProjectionScopeState): void => {
  const current = useAgentGroupStore.getState();
  const groupMap = { ...current.groupMap };
  const groupNotFoundMap = { ...current.groupNotFoundMap };

  for (const [id, record] of Object.entries(scope.records.chatGroup)) {
    if (!activeProjectionRecord(record)) {
      delete groupMap[id];
      groupNotFoundMap[id] = true;
      continue;
    }
    const detail = selectChatGroupDetail(scope, id);
    const item = detail ?? selectChatGroupItem(record);
    if (item) {
      groupMap[id] = detail ?? { ...item, agents: groupMap[id]?.agents ?? [] };
      delete groupNotFoundMap[id];
    }
  }

  const list = selectChatGroupList(scope);
  const groups = (list ?? current.groups) as typeof current.groups;
  const groupsInit = list ? true : current.groupsInit;
  if (
    isEqual(current.groupMap, groupMap) &&
    isEqual(current.groupNotFoundMap, groupNotFoundMap) &&
    isEqual(current.groups, groups) &&
    current.groupsInit === groupsInit
  ) {
    return;
  }
  useAgentGroupStore.setState({ groupMap, groupNotFoundMap, groups, groupsInit });
};

const topicDataFromIndex = (
  scope: ProjectionScopeState,
  index: ChatTopicsIndex,
  current: TopicData | undefined,
): TopicData | undefined => {
  if (
    !index.key.startsWith('chat.agentViewTopics:') &&
    !index.key.startsWith('chat.sidebarTopics:')
  ) {
    return undefined;
  }

  const selectedItems = selectChatTopicsItems(scope, index);
  if (!selectedItems) return undefined;
  const items = selectedItems as ChatTopic[];

  const pageSize = index.persistRefLimit;
  return {
    ...current,
    currentPage: Math.max(0, Math.ceil(items.length / pageSize) - 1),
    excludeStatuses: index.signature.excludeStatuses,
    excludeTriggers: index.signature.excludeTriggers,
    hasMore: index.total > items.length,
    isInbox: index.signature.isInbox,
    items,
    pageSize,
    sortBy: index.signature.sortBy,
    total: index.total,
    withDetails: index.signature.withDetails,
  };
};

const syncTopics = (scope: ProjectionScopeState): void => {
  const current = useChatStore.getState();
  const topicDataMap = { ...current.topicDataMap };
  const agentTopicsViewMap = { ...current.agentTopicsViewMap };
  const searchTopics = current.searchTopics.flatMap((item) => {
    const record = scope.records.topic[item.id];
    if (record && !activeProjectionRecord(record)) return [];
    const canonical = selectChatTopicListItem(scope, item.id);
    return [canonical ? (canonical as ChatTopic) : item];
  });

  for (const index of Object.values(scope.indexes)) {
    if (!index) continue;
    const agentViewPrefix = 'chat.agentViewTopics:';
    const sidebarPrefix = 'chat.sidebarTopics:';
    if (index.key.startsWith(agentViewPrefix)) {
      const key = index.key.slice(agentViewPrefix.length);
      const data = topicDataFromIndex(scope, index as ChatTopicsIndex, agentTopicsViewMap[key]);
      if (data) agentTopicsViewMap[key] = data;
    } else if (index.key.startsWith(sidebarPrefix)) {
      const key = index.key.slice(sidebarPrefix.length);
      const data = topicDataFromIndex(scope, index as ChatTopicsIndex, topicDataMap[key]);
      if (data) topicDataMap[key] = data;
    }
  }

  if (
    isEqual(current.topicDataMap, topicDataMap) &&
    isEqual(current.agentTopicsViewMap, agentTopicsViewMap) &&
    isEqual(current.searchTopics, searchTopics)
  ) {
    return;
  }
  useChatStore.setState({ agentTopicsViewMap, searchTopics, topicDataMap });
};

const syncTasks = (scope: ProjectionScopeState): void => {
  const current = useTaskStore.getState();
  const taskDetailMap = { ...current.taskDetailMap };

  for (const [recordId, record] of Object.entries(scope.records.task)) {
    if (!activeProjectionRecord(record)) {
      for (const [key, detail] of Object.entries(taskDetailMap)) {
        if (key === recordId || detail.id === recordId || detail.identifier === recordId) {
          delete taskDetailMap[key];
        }
      }
      continue;
    }
    const detail = selectTaskDetail(record);
    if (!detail) continue;
    taskDetailMap[recordId] = detail;
    taskDetailMap[detail.identifier] = detail;
    if (detail.id) taskDetailMap[detail.id] = detail;
  }

  const signature = {
    agentKey: current.listAgentId,
    visibility: current.listQueryVisibility,
  } as const;
  const listIndex = selectTaskListIndex(scope, signature);
  const tasks = listIndex
    ? listIndex.refs.flatMap((ref) => {
        const item = selectTaskListItem(scope, scope.records.task[ref.id]);
        return item ? [item] : [];
      })
    : current.tasks;
  const tasksTotal = listIndex?.total ?? current.tasksTotal;
  const isTaskListInit = listIndex ? true : current.isTaskListInit;

  const projectedTaskGroups = selectTaskGroupList(scope, {
    agentKey: current.listAgentId,
    visibility: current.listVisibility,
  });
  const taskGroups = projectedTaskGroups ?? current.taskGroups;
  const isTaskGroupListInit = projectedTaskGroups ? true : current.isTaskGroupListInit;

  if (
    isEqual(current.taskDetailMap, taskDetailMap) &&
    isEqual(current.tasks, tasks) &&
    current.tasksTotal === tasksTotal &&
    current.isTaskListInit === isTaskListInit &&
    isEqual(current.taskGroups, taskGroups) &&
    current.isTaskGroupListInit === isTaskGroupListInit
  ) {
    return;
  }
  useTaskStore.setState({
    isTaskGroupListInit,
    isTaskListInit,
    taskDetailMap: taskDetailMap as Record<string, TaskDetailData>,
    taskGroups,
    tasks,
    tasksTotal,
  });
};

const syncBriefs = (scopeName: string, scope: ProjectionScopeState): void => {
  const briefs = selectHomeBriefs(scope);
  if (!briefs) return;
  const current = useBriefStore.getState();
  if (
    current.briefsScope === scopeName &&
    current.isBriefsInit &&
    isEqual(current.briefs, briefs)
  ) {
    return;
  }
  useBriefStore.setState({ briefs, briefsScope: scopeName, isBriefsInit: true });
};

const syncHomeSidebar = (scopeName: string, scope: ProjectionScopeState): void => {
  getHomeStoreState().internal_syncAgentListProjection(selectHomeSidebar(scope), scopeName);
};

export const syncProjectionLegacyStores = (scopeName: string): void => {
  if (lastScope !== scopeName) {
    resetScopedLegacyState(scopeName);
    lastScope = scopeName;
  }

  const scope = useProjectionStore.getState().scopes[scopeName];
  if (!scope) return;
  syncAgents(scope);
  syncChatGroups(scope);
  syncTopics(scope);
  syncTasks(scope);
  syncBriefs(scopeName, scope);
  syncHomeSidebar(scopeName, scope);
};

/**
 * Temporary compatibility boundary while business selectors move to Projection.
 * Projection remains the canonical owner; these writes only materialize the
 * legacy Zustand shapes still consumed by existing UI modules.
 */
export const ensureProjectionLegacyBridge = (): void => {
  if (bridgeStarted) return;
  bridgeStarted = true;
  useProjectionStore.subscribe(
    (state) => state.scopes,
    () => syncProjectionLegacyStores(getCacheScope()),
    { fireImmediately: true },
  );
};

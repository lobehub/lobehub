import type {
  BriefItem,
  HomeAgentRecord,
  HomeBriefRecord,
  HomeDailyBriefResponse,
  HomeRecentTopicView,
  HomeRecentTopicsView,
  HomeSidebarEntityRef,
  HomeSidebarGroupIndex,
  HomeTaskCardView,
  HomeTaskRecord,
  HomeTopicRecord,
  HomeTopicView,
  SidebarAgentItem,
  SidebarAgentListResponse,
  SidebarGroup,
} from '@lobechat/types';

import type { EntityStoreState, HomeEntityScopeState } from './initialState';

const scopeState = (scope: string) => (state: EntityStoreState) => state.scopes[scope];
const isScopeReady = (scope: string) => (state: EntityStoreState) =>
  state.scopes[scope]?.hydrationStatus === 'ready';

const activeRecord = <T extends { tombstoneAt?: number }>(record: T | undefined): T | undefined =>
  record && !record.tombstoneAt ? record : undefined;

export const selectHomeSidebarItem = (
  scope: HomeEntityScopeState,
  ref: HomeSidebarEntityRef,
): SidebarAgentItem | undefined => {
  if (ref.kind === 'chatGroup') {
    const record = activeRecord(scope.entities.chatGroup[ref.id]);
    const identity = record?.fragments.identity?.data;
    const access = record?.fragments.access?.data;
    if (!identity || !access) return undefined;

    return {
      ...identity,
      ...access,
      id: ref.id,
      pinned: ref.pinned,
      type: 'group',
      unreadCount: ref.unreadCount,
      updatedAt: ref.updatedAt,
    };
  }

  const record = activeRecord(scope.entities.agent[ref.id]);
  const identity = record?.fragments.identity?.data;
  const access = record?.fragments.access?.data;
  const profile = record?.fragments.profile?.data;
  const routing = record?.fragments.routing?.data;
  const runtime = record?.fragments.runtime?.data;
  if (!identity || !access || !profile || !routing || !runtime) return undefined;

  return {
    ...identity,
    ...profile,
    ...access,
    ...routing,
    ...runtime,
    id: ref.id,
    pinned: ref.pinned,
    type: 'agent',
    unreadCount: ref.unreadCount,
    updatedAt: ref.updatedAt,
  };
};

const sidebarItems = (
  scope: HomeEntityScopeState,
  refs: HomeSidebarEntityRef[],
  indexObservedAt: number,
): SidebarAgentItem[] | undefined => {
  const items: SidebarAgentItem[] = [];
  for (const ref of refs) {
    const record =
      ref.kind === 'chatGroup' ? scope.entities.chatGroup[ref.id] : scope.entities.agent[ref.id];
    if (record?.tombstoneAt && record.tombstoneAt >= indexObservedAt) continue;
    const item = selectHomeSidebarItem(scope, ref);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

const sidebarGroups = (
  scope: HomeEntityScopeState,
  groups: HomeSidebarGroupIndex[],
  indexObservedAt: number,
): SidebarGroup[] | undefined => {
  const result: SidebarGroup[] = [];
  for (const group of groups) {
    const items = sidebarItems(scope, group.items, indexObservedAt);
    if (!items) return undefined;
    result.push({
      id: group.id,
      items,
      name: group.name,
      sort: group.sort,
      visibility: group.visibility,
    });
  }
  return result;
};

export const selectHomeSidebar = (
  scope: HomeEntityScopeState | undefined,
): SidebarAgentListResponse | undefined => {
  const index = scope?.indexes['home.sidebar'];
  if (!scope || !index || index.key !== 'home.sidebar') return undefined;

  const pinned = sidebarItems(scope, index.pinned, index.observedAt);
  const groups = sidebarGroups(scope, index.groups, index.observedAt);
  const ungrouped = sidebarItems(scope, index.ungrouped, index.observedAt);
  const privatePinned = sidebarItems(scope, index.privatePinned, index.observedAt);
  const privateGroups = sidebarGroups(scope, index.privateGroups, index.observedAt);
  const privateUngrouped = sidebarItems(scope, index.privateUngrouped, index.observedAt);
  if (!pinned || !groups || !ungrouped || !privatePinned || !privateGroups || !privateUngrouped) {
    return undefined;
  }

  return { groups, pinned, privateGroups, privatePinned, privateUngrouped, ungrouped };
};

export const selectHomeRecentTopic = (
  record: HomeTopicRecord | undefined,
): HomeRecentTopicView | undefined => {
  const active = activeRecord(record);
  const display = active?.fragments.display?.data;
  const activity = active?.fragments.activity?.data;
  const routing = active?.fragments.routing?.data;
  const navigation = active?.fragments.recentNavigation?.data;
  const preview = active?.fragments.homePreview?.data;
  if (!display || !activity || !routing || !navigation?.routePath) return undefined;

  return {
    agentId: routing.agentId,
    description: preview?.description,
    icon: 'topic',
    id: active.id,
    lastAssistantMessage: preview?.lastAssistantMessage,
    routePath: navigation.routePath,
    status: null,
    title: display.title,
    type: 'topic',
    updatedAt: activity.updatedAt,
    userId: preview?.userId,
  };
};

export const selectHomeRecentTopics = (
  scope: HomeEntityScopeState | undefined,
  limit?: number,
  view?: HomeRecentTopicsView,
): HomeRecentTopicView[] | undefined => {
  const index = scope?.indexes['home.recentTopics'];
  if (!scope || !index || index.key !== 'home.recentTopics') return undefined;
  if (limit !== undefined && index.limit < limit) return undefined;
  if (view !== undefined && index.view !== view) return undefined;
  const views: HomeRecentTopicView[] = [];
  for (const ref of limit === undefined ? index.refs : index.refs.slice(0, limit)) {
    const record = scope.entities.topic[ref.id];
    if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) continue;
    const view = selectHomeRecentTopic(record);
    if (!view) return undefined;
    views.push(view);
  }
  return views;
};

export const selectHomeInboxTopic = (
  record: HomeTopicRecord | undefined,
): HomeTopicView | undefined => {
  const active = activeRecord(record);
  const display = active?.fragments.display?.data;
  const activity = active?.fragments.activity?.data;
  const routing = active?.fragments.routing?.data;
  const status = active?.fragments.status?.data;
  const timing = active?.fragments.runTiming?.data;
  const preview = active?.fragments.homePreview?.data;
  if (!display || !activity || !routing || !status || !timing || !preview) return undefined;

  return {
    ...display,
    ...activity,
    ...routing,
    ...status,
    ...timing,
    ...preview,
    ...active.fragments.creation?.data,
    id: active.id,
  };
};

export const selectHomeInboxTopics = (
  scope: HomeEntityScopeState | undefined,
): HomeTopicView[] | undefined => {
  const index = scope?.indexes['home.inboxTopics'];
  if (!scope || !index || index.key !== 'home.inboxTopics') return undefined;
  const views: HomeTopicView[] = [];
  for (const ref of index.refs) {
    const record = scope.entities.topic[ref.id];
    if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) continue;
    const view = selectHomeInboxTopic(record);
    if (!view) return undefined;
    views.push(view);
  }
  return views;
};

export const selectHomeTask = (
  record: HomeTaskRecord | undefined,
): HomeTaskCardView | undefined => {
  const active = activeRecord(record);
  const identity = active?.fragments.identity?.data;
  const display = active?.fragments.display?.data;
  const description = active?.fragments.description?.data;
  const lifecycle = active?.fragments.lifecycle?.data;
  if (!identity || !display || !description || !lifecycle) return undefined;

  return {
    ...identity,
    ...display,
    ...description,
    ...lifecycle,
    id: active.id,
  };
};

export const selectHomeTasks = (
  scope: HomeEntityScopeState | undefined,
): HomeTaskCardView[] | undefined => {
  const index = scope?.indexes['home.tasks'];
  if (!scope || !index || index.key !== 'home.tasks') return undefined;
  const views: HomeTaskCardView[] = [];
  for (const ref of index.refs) {
    const record = scope.entities.task[ref.id];
    if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) continue;
    const view = selectHomeTask(record);
    if (!view) return undefined;
    views.push(view);
  }
  return views;
};

const agentEnrichment = (record: HomeAgentRecord | undefined): BriefItem['agent'] => {
  const identity = activeRecord(record)?.fragments.identity?.data;
  if (!identity) return null;

  return {
    avatar: typeof identity.avatar === 'string' ? identity.avatar : null,
    backgroundColor: identity.backgroundColor ?? null,
    id: record!.id,
    name: identity.name ?? null,
    title: identity.title ?? null,
  };
};

const taskEnrichment = (
  record: HomeTaskRecord | undefined,
): Pick<BriefItem, 'taskIdentifier' | 'taskName' | 'taskStatus'> => {
  const active = activeRecord(record);
  return {
    taskIdentifier: active?.fragments.identity?.data.identifier,
    taskName: active?.fragments.display?.data.name,
    taskStatus: active?.fragments.lifecycle?.data.status,
  };
};

export const selectHomeBrief = (
  record: HomeBriefRecord | undefined,
  agentRecord?: HomeAgentRecord,
  taskRecord?: HomeTaskRecord,
): BriefItem | undefined => {
  const active = activeRecord(record);
  const content = active?.fragments.content?.data;
  const actions = active?.fragments.actions?.data;
  const readState = active?.fragments.readState?.data;
  const relations = active?.fragments.relations?.data;
  const resolution = active?.fragments.resolution?.data;
  if (!content || !actions || !readState || !relations || !resolution) return undefined;

  return {
    ...content,
    ...actions,
    ...readState,
    ...relations,
    ...resolution,
    ...taskEnrichment(relations.taskId ? taskRecord : undefined),
    agent: relations.agentId ? agentEnrichment(agentRecord) : null,
    id: active.id,
  };
};

export const selectHomeBriefs = (
  scope: HomeEntityScopeState | undefined,
): BriefItem[] | undefined => {
  const index = scope?.indexes['home.unresolvedBriefs'];
  if (!scope || !index || index.key !== 'home.unresolvedBriefs') return undefined;
  const views: BriefItem[] = [];
  for (const ref of index.refs) {
    const record = scope.entities.brief[ref.id];
    if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) continue;
    const relations = record?.fragments.relations?.data;
    const view = selectHomeBrief(
      record,
      relations?.agentId ? scope.entities.agent[relations.agentId] : undefined,
      relations?.taskId ? scope.entities.task[relations.taskId] : undefined,
    );
    if (!view) return undefined;
    views.push(view);
  }
  return views;
};

export const selectHomeDailyBrief = (
  scope: HomeEntityScopeState | undefined,
): HomeDailyBriefResponse | undefined => {
  const snapshot = scope?.snapshots['home.dailyBrief'];
  return snapshot?.key === 'home.dailyBrief' ? snapshot.data : undefined;
};

export const findTaskRecord = (
  scope: HomeEntityScopeState | undefined,
  identity: string,
): HomeTaskRecord | undefined => {
  if (!scope) return undefined;
  const direct = scope.entities.task[identity];
  if (direct) return direct;
  return Object.values(scope.entities.task).find(
    (record) => record.fragments.identity?.data.identifier === identity,
  );
};

export const entitySelectors = {
  isScopeReady,
  scopeState,
};

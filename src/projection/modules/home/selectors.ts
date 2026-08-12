import type {
  AgentProjection,
  BriefItem,
  BriefProjection,
  HomeDailyBriefResponse,
  HomeRecentTopicsView,
  HomeRecentTopicView,
  HomeSidebarGroupIndex,
  HomeSidebarProjectionRef,
  HomeTaskCardView,
  HomeTopicView,
  ProjectionRecord,
  SidebarAgentItem,
  SidebarAgentListResponse,
  SidebarGroup,
  TaskProjection,
  TopicProjection,
} from '@lobechat/types';

import type { ProjectionScopeState } from '../../core/initialState';
import { activeProjectionRecord } from '../../core/record';

const activeRecord = <T extends ProjectionRecord>(record: T | undefined): T | undefined =>
  activeProjectionRecord(record);

export const selectHomeSidebarItem = (
  scope: ProjectionScopeState,
  ref: HomeSidebarProjectionRef,
): SidebarAgentItem | undefined => {
  if (ref.kind === 'chatGroup') {
    const record = activeRecord(scope.records.chatGroup[ref.id]);
    const identity = record?.fragments.identity?.data;
    const access = record?.fragments.access?.data;
    if (!identity || !access) return undefined;

    return {
      ...identity,
      ...access,
      id: ref.id,
      pinned: ref.pinned,
      title: identity.title ?? null,
      type: 'group',
      unreadCount: ref.unreadCount,
      updatedAt: ref.updatedAt,
    };
  }

  const record = activeRecord(scope.records.agent[ref.id]);
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
    labels: ref.labels,
    pinned: ref.pinned,
    title: identity.title ?? null,
    type: 'agent',
    unreadCount: ref.unreadCount,
    updatedAt: ref.updatedAt,
  };
};

const sidebarItems = (
  scope: ProjectionScopeState,
  refs: HomeSidebarProjectionRef[],
  indexObservedAt: number,
): SidebarAgentItem[] | undefined => {
  const items: SidebarAgentItem[] = [];
  for (const ref of refs) {
    const record =
      ref.kind === 'chatGroup' ? scope.records.chatGroup[ref.id] : scope.records.agent[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= indexObservedAt) continue;
    const item = selectHomeSidebarItem(scope, ref);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

const sidebarGroups = (
  scope: ProjectionScopeState,
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
  scope: ProjectionScopeState | undefined,
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
  record: TopicProjection | undefined,
): HomeRecentTopicView | undefined => {
  const active = activeRecord(record);
  const display = active?.fragments.display?.data;
  const activity = active?.fragments.activity?.data;
  const routing = active?.fragments.routing?.data;
  const navigation = active?.fragments.navigation?.data;
  const preview = active?.fragments.preview?.data;
  const ownership = active?.fragments.ownership?.data;
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
    userId: ownership?.userId,
  };
};

export const selectHomeRecentTopics = (
  scope: ProjectionScopeState | undefined,
  limit?: number,
  view?: HomeRecentTopicsView,
): HomeRecentTopicView[] | undefined => {
  const index = scope?.indexes['home.recentTopics'];
  if (!scope || !index || index.key !== 'home.recentTopics') return undefined;
  if (limit !== undefined && index.limit < limit) return undefined;
  if (view !== undefined && index.view !== view) return undefined;
  const views: HomeRecentTopicView[] = [];
  for (const ref of limit === undefined ? index.refs : index.refs.slice(0, limit)) {
    const record = scope.records.topic[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const topicView = selectHomeRecentTopic(record);
    if (!topicView) return undefined;
    views.push(topicView);
  }
  return views;
};

export const selectHomeInboxTopic = (
  record: TopicProjection | undefined,
): HomeTopicView | undefined => {
  const active = activeRecord(record);
  const display = active?.fragments.display?.data;
  const activity = active?.fragments.activity?.data;
  const routing = active?.fragments.routing?.data;
  const status = active?.fragments.status?.data;
  const timing = active?.fragments.runTiming?.data;
  const preview = active?.fragments.preview?.data;
  const ownership = active?.fragments.ownership?.data;
  const triggerInfo = active?.fragments.triggerInfo?.data;
  if (
    !display ||
    !activity ||
    !routing ||
    !status ||
    !timing ||
    !preview ||
    !ownership ||
    !triggerInfo
  )
    return undefined;

  return {
    ...display,
    ...activity,
    ...routing,
    ...status,
    ...timing,
    ...preview,
    ...ownership,
    ...triggerInfo,
    ...active.fragments.creation?.data,
    id: active.id,
  };
};

export const selectHomeInboxTopics = (
  scope: ProjectionScopeState | undefined,
): HomeTopicView[] | undefined => {
  const index = scope?.indexes['home.inboxTopics'];
  if (!scope || !index || index.key !== 'home.inboxTopics') return undefined;
  const views: HomeTopicView[] = [];
  for (const ref of index.refs) {
    const record = scope.records.topic[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const view = selectHomeInboxTopic(record);
    if (!view) return undefined;
    views.push(view);
  }
  return views;
};

export const selectHomeTask = (
  record: TaskProjection | undefined,
): HomeTaskCardView | undefined => {
  const active = activeRecord(record);
  const assignment = active?.fragments.assignment?.data;
  const identity = active?.fragments.identity?.data;
  const display = active?.fragments.display?.data;
  const description = active?.fragments.description?.data;
  const lifecycle = active?.fragments.lifecycle?.data;
  const row = active?.fragments.row?.data;
  if (
    !assignment ||
    !identity ||
    display?.name === undefined ||
    description?.description === undefined ||
    !lifecycle ||
    !row
  )
    return undefined;

  return {
    assigneeAgentId: assignment.assigneeAgentId,
    automationMode: row.automationMode,
    createdAt: row.createdAt,
    description: description.description,
    heartbeatInterval: row.heartbeatInterval,
    id: active.id,
    identifier: identity.identifier,
    instruction: row.instruction,
    name: display.name,
    schedulePattern: row.schedulePattern,
    scheduleTimezone: row.scheduleTimezone,
    status: lifecycle.status,
    updatedAt: row.updatedAt,
  };
};

const selectHomeTaskList = (
  scope: ProjectionScopeState | undefined,
  indexKey: 'home.scheduledTasks' | 'home.tasks',
): HomeTaskCardView[] | undefined => {
  const index = scope?.indexes[indexKey];
  if (!scope || !index || index.key !== indexKey) return undefined;
  const views: HomeTaskCardView[] = [];
  for (const ref of index.refs) {
    const record = scope.records.task[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const view = selectHomeTask(record);
    if (!view) return undefined;
    views.push(view);
  }
  return views;
};

export const selectHomeTasks = (
  scope: ProjectionScopeState | undefined,
): HomeTaskCardView[] | undefined => selectHomeTaskList(scope, 'home.tasks');

export const selectHomeScheduledTasks = (
  scope: ProjectionScopeState | undefined,
): HomeTaskCardView[] | undefined => selectHomeTaskList(scope, 'home.scheduledTasks');

const agentEnrichment = (record: AgentProjection | undefined): BriefItem['agent'] => {
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
  record: TaskProjection | undefined,
): Pick<BriefItem, 'taskIdentifier' | 'taskName' | 'taskStatus'> => {
  const active = activeRecord(record);
  return {
    taskIdentifier: active?.fragments.identity?.data.identifier,
    taskName: active?.fragments.display?.data.name,
    taskStatus: active?.fragments.lifecycle?.data.status,
  };
};

export const selectHomeBrief = (
  record: BriefProjection | undefined,
  agentRecord?: AgentProjection,
  taskRecord?: TaskProjection,
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
  scope: ProjectionScopeState | undefined,
): BriefItem[] | undefined => {
  const index = scope?.indexes['home.unresolvedBriefs'];
  if (!scope || !index || index.key !== 'home.unresolvedBriefs') return undefined;
  const views: BriefItem[] = [];
  for (const ref of index.refs) {
    const record = scope.records.brief[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const relations = record?.fragments.relations?.data;
    const view = selectHomeBrief(
      record,
      relations?.agentId ? scope.records.agent[relations.agentId] : undefined,
      relations?.taskId ? scope.records.task[relations.taskId] : undefined,
    );
    if (!view) return undefined;
    views.push(view);
  }
  return views;
};

export const selectHomeDailyBrief = (
  scope: ProjectionScopeState | undefined,
  now = Date.now(),
): HomeDailyBriefResponse | undefined => {
  const snapshot = scope?.snapshots['home.dailyBrief'];
  if (snapshot?.key !== 'home.dailyBrief') return undefined;

  const observed = new Date(snapshot.observedAt);
  const current = new Date(now);
  const isCurrentLocalDay =
    observed.getFullYear() === current.getFullYear() &&
    observed.getMonth() === current.getMonth() &&
    observed.getDate() === current.getDate();

  return isCurrentLocalDay ? snapshot.data : undefined;
};

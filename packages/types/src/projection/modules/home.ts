import type { HomeDailyBriefResponse, HomeRecentItem, SidebarVisibility } from '../../home';
import type { TaskAutomationMode, TaskItem, TaskStatus } from '../../task';
import type { ProjectionRef, ProjectionSource } from '../base';

export type HomeIndexKey =
  | 'home.inboxTopics'
  | 'home.recentTopics'
  | 'home.scheduledTasks'
  | 'home.sidebar'
  | 'home.tasks'
  | 'home.unresolvedBriefs';

export interface HomeIndexBase<K extends HomeIndexKey> {
  key: K;
  observedAt: number;
  source: ProjectionSource;
}

export interface HomeSidebarProjectionRef extends ProjectionRef<'agent' | 'chatGroup'> {
  pinned: boolean;
  unreadCount?: number;
  updatedAt: Date;
}

export interface HomeSidebarGroupIndex {
  id: string;
  items: HomeSidebarProjectionRef[];
  name: string;
  sort: number | null;
  visibility?: SidebarVisibility;
}

export interface HomeSidebarIndex extends HomeIndexBase<'home.sidebar'> {
  groups: HomeSidebarGroupIndex[];
  pinned: HomeSidebarProjectionRef[];
  privateGroups: HomeSidebarGroupIndex[];
  privatePinned: HomeSidebarProjectionRef[];
  privateUngrouped: HomeSidebarProjectionRef[];
  ungrouped: HomeSidebarProjectionRef[];
}

export type HomeRecentTopicsView = 'mine' | 'team';

export interface HomeRecentTopicsIndex extends HomeIndexBase<'home.recentTopics'> {
  limit: number;
  refs: ProjectionRef<'topic'>[];
  /** Workspace mine/team feed the refs were fetched for — the views must not bleed into each other. */
  view: HomeRecentTopicsView;
}

export interface HomeInboxTopicsIndex extends HomeIndexBase<'home.inboxTopics'> {
  refs: ProjectionRef<'topic'>[];
}

export interface HomeTasksIndex extends HomeIndexBase<'home.tasks'> {
  refs: ProjectionRef<'task'>[];
  total: number;
}

export interface HomeScheduledTasksIndex extends HomeIndexBase<'home.scheduledTasks'> {
  refs: ProjectionRef<'task'>[];
  total: number;
}

export interface HomeUnresolvedBriefsIndex extends HomeIndexBase<'home.unresolvedBriefs'> {
  refs: ProjectionRef<'brief'>[];
}

export interface HomeIndexMap {
  'home.inboxTopics': HomeInboxTopicsIndex;
  'home.recentTopics': HomeRecentTopicsIndex;
  'home.scheduledTasks': HomeScheduledTasksIndex;
  'home.sidebar': HomeSidebarIndex;
  'home.tasks': HomeTasksIndex;
  'home.unresolvedBriefs': HomeUnresolvedBriefsIndex;
}

export type HomeIndex = HomeIndexMap[keyof HomeIndexMap];

export type HomeSnapshotKey = 'home.dailyBrief';

export interface HomeDailyBriefSnapshot {
  data: HomeDailyBriefResponse;
  key: 'home.dailyBrief';
  observedAt: number;
  source: ProjectionSource;
}

export interface HomeSnapshotMap {
  'home.dailyBrief': HomeDailyBriefSnapshot;
}

export type HomeSnapshot = HomeSnapshotMap[keyof HomeSnapshotMap];

export type HomeTaskCardView = Pick<
  TaskItem,
  | 'assigneeAgentId'
  | 'createdAt'
  | 'description'
  | 'heartbeatInterval'
  | 'id'
  | 'identifier'
  | 'instruction'
  | 'name'
  | 'schedulePattern'
  | 'scheduleTimezone'
  | 'updatedAt'
> & {
  automationMode: TaskAutomationMode | null;
  status: TaskStatus;
};

export type HomeRecentTopicView = HomeRecentItem & { type: 'topic' };

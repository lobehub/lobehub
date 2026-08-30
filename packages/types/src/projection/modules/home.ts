import type {
  HomeDailyBriefResponse,
  HomeRecentItem,
  SidebarAgentLabel,
  SidebarVisibility,
} from '../../home';
import type { TaskAutomationMode, TaskItem, TaskStatus } from '../../task';
import type { ProjectionRef, ProjectionSource } from '../base';
import type { ProjectionKeyOf } from '../runtime';
import { defineProjectionKeySpace } from '../runtime';

export const HOME_INDEX_KEYS = {
  inboxTopics: 'home.inboxTopics',
  recentTopics: 'home.recentTopics',
  scheduledTasks: 'home.scheduledTasks',
  sidebar: 'home.sidebar',
  tasks: 'home.tasks',
  unresolvedBriefs: 'home.unresolvedBriefs',
} as const;

export const HOME_SNAPSHOT_KEYS = {
  dailyBrief: 'home.dailyBrief',
} as const;

export const homeIndexKeySpace = defineProjectionKeySpace({
  patterns: [],
  staticKeys: Object.values(HOME_INDEX_KEYS),
});

export const homeSnapshotKeySpace = defineProjectionKeySpace({
  patterns: [],
  staticKeys: Object.values(HOME_SNAPSHOT_KEYS),
});

export type HomeIndexKey = ProjectionKeyOf<typeof homeIndexKeySpace>;
export type HomeInboxTopicsIndexKey = typeof HOME_INDEX_KEYS.inboxTopics;
export type HomeRecentTopicsIndexKey = typeof HOME_INDEX_KEYS.recentTopics;
export type HomeScheduledTasksIndexKey = typeof HOME_INDEX_KEYS.scheduledTasks;
export type HomeSidebarIndexKey = typeof HOME_INDEX_KEYS.sidebar;
export type HomeTasksIndexKey = typeof HOME_INDEX_KEYS.tasks;
export type HomeUnresolvedBriefsIndexKey = typeof HOME_INDEX_KEYS.unresolvedBriefs;

export interface HomeIndexBase<K extends HomeIndexKey> {
  key: K;
  observedAt: number;
  source: ProjectionSource;
}

export interface HomeSidebarProjectionRef extends ProjectionRef<'agent' | 'chatGroup'> {
  labels?: SidebarAgentLabel[];
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

export interface HomeSidebarIndex extends HomeIndexBase<HomeSidebarIndexKey> {
  groups: HomeSidebarGroupIndex[];
  pinned: HomeSidebarProjectionRef[];
  privateGroups: HomeSidebarGroupIndex[];
  privatePinned: HomeSidebarProjectionRef[];
  privateUngrouped: HomeSidebarProjectionRef[];
  ungrouped: HomeSidebarProjectionRef[];
}

export type HomeRecentTopicsView = 'mine' | 'team';

export interface HomeRecentTopicsIndex extends HomeIndexBase<HomeRecentTopicsIndexKey> {
  limit: number;
  refs: ProjectionRef<'topic'>[];
  /** Workspace mine/team feed the refs were fetched for — the views must not bleed into each other. */
  view: HomeRecentTopicsView;
}

export interface HomeInboxTopicsIndex extends HomeIndexBase<HomeInboxTopicsIndexKey> {
  refs: ProjectionRef<'topic'>[];
}

export interface HomeTasksIndex extends HomeIndexBase<HomeTasksIndexKey> {
  refs: ProjectionRef<'task'>[];
  total: number;
}

export interface HomeScheduledTasksIndex extends HomeIndexBase<HomeScheduledTasksIndexKey> {
  refs: ProjectionRef<'task'>[];
  total: number;
}

export interface HomeUnresolvedBriefsIndex extends HomeIndexBase<HomeUnresolvedBriefsIndexKey> {
  refs: ProjectionRef<'brief'>[];
}

export interface HomeIndexMap {
  [HOME_INDEX_KEYS.inboxTopics]: HomeInboxTopicsIndex;
  [HOME_INDEX_KEYS.recentTopics]: HomeRecentTopicsIndex;
  [HOME_INDEX_KEYS.scheduledTasks]: HomeScheduledTasksIndex;
  [HOME_INDEX_KEYS.sidebar]: HomeSidebarIndex;
  [HOME_INDEX_KEYS.tasks]: HomeTasksIndex;
  [HOME_INDEX_KEYS.unresolvedBriefs]: HomeUnresolvedBriefsIndex;
}

export type HomeIndex = HomeIndexMap[keyof HomeIndexMap];

export type HomeSnapshotKey = ProjectionKeyOf<typeof homeSnapshotKeySpace>;

export interface HomeDailyBriefSnapshot {
  data: HomeDailyBriefResponse;
  key: HomeSnapshotKey;
  observedAt: number;
  source: ProjectionSource;
}

export interface HomeSnapshotMap {
  [HOME_SNAPSHOT_KEYS.dailyBrief]: HomeDailyBriefSnapshot;
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

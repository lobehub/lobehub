import type { EntityRef, EntitySource } from '../../entity';
import type { HomeDailyBriefResponse, HomeRecentItem, SidebarVisibility } from '../../home';
import type { TaskStatus } from '../../task';

export type HomeIndexKey =
  | 'home.inboxTopics'
  | 'home.recentTopics'
  | 'home.sidebar'
  | 'home.tasks'
  | 'home.unresolvedBriefs';

export interface HomeIndexBase<K extends HomeIndexKey> {
  key: K;
  observedAt: number;
  source: EntitySource;
}

export interface HomeSidebarEntityRef extends EntityRef<'agent' | 'chatGroup'> {
  pinned: boolean;
  unreadCount?: number;
  updatedAt: Date;
}

export interface HomeSidebarGroupIndex {
  id: string;
  items: HomeSidebarEntityRef[];
  name: string;
  sort: number | null;
  visibility?: SidebarVisibility;
}

export interface HomeSidebarIndex extends HomeIndexBase<'home.sidebar'> {
  groups: HomeSidebarGroupIndex[];
  pinned: HomeSidebarEntityRef[];
  privateGroups: HomeSidebarGroupIndex[];
  privatePinned: HomeSidebarEntityRef[];
  privateUngrouped: HomeSidebarEntityRef[];
  ungrouped: HomeSidebarEntityRef[];
}

export type HomeRecentTopicsView = 'mine' | 'team';

export interface HomeRecentTopicsIndex extends HomeIndexBase<'home.recentTopics'> {
  limit: number;
  refs: EntityRef<'topic'>[];
  /** Workspace mine/team feed the refs were fetched for — the views must not bleed into each other. */
  view: HomeRecentTopicsView;
}

export interface HomeInboxTopicsIndex extends HomeIndexBase<'home.inboxTopics'> {
  refs: EntityRef<'topic'>[];
}

export interface HomeTasksIndex extends HomeIndexBase<'home.tasks'> {
  refs: EntityRef<'task'>[];
  total: number;
}

export interface HomeUnresolvedBriefsIndex extends HomeIndexBase<'home.unresolvedBriefs'> {
  refs: EntityRef<'brief'>[];
}

export interface HomeIndexMap {
  'home.inboxTopics': HomeInboxTopicsIndex;
  'home.recentTopics': HomeRecentTopicsIndex;
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
  source: EntitySource;
}

export interface HomeSnapshotMap {
  'home.dailyBrief': HomeDailyBriefSnapshot;
}

export type HomeSnapshot = HomeSnapshotMap[keyof HomeSnapshotMap];

export interface HomeTaskCardView {
  description?: string | null;
  id: string;
  identifier: string;
  name?: string | null;
  status: TaskStatus;
}

export type HomeRecentTopicView = HomeRecentItem & { type: 'topic' };

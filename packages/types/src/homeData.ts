import type { BriefItem } from './brief';
import type { EntityRecord, EntityRef, EntitySource, EntityTombstone } from './entity';
import type {
  HomeDailyBriefResponse,
  HomeRecentItem,
  HomeTopicView,
  SidebarAgentItem,
  SidebarVisibility,
} from './home';
import type { TaskListItem, TaskStatus } from './task';

export type HomeEntityKind = 'agent' | 'brief' | 'chatGroup' | 'task' | 'topic';

export interface HomeAgentFragments {
  access: Pick<SidebarAgentItem, 'userId' | 'visibility'>;
  identity: Pick<SidebarAgentItem, 'avatar' | 'backgroundColor' | 'name' | 'title'>;
  profile: Pick<SidebarAgentItem, 'description' | 'slug'>;
  routing: Pick<SidebarAgentItem, 'sessionId'>;
  runtime: Pick<SidebarAgentItem, 'heterogeneousType'>;
}

export interface HomeChatGroupFragments {
  access: Pick<SidebarAgentItem, 'userId' | 'visibility'>;
  identity: Pick<
    SidebarAgentItem,
    'avatar' | 'backgroundColor' | 'description' | 'groupAvatar' | 'title'
  >;
}

export interface HomeTopicFragments {
  activity: Pick<HomeTopicView, 'updatedAt'>;
  creation: Pick<HomeTopicView, 'createdAt'>;
  display: Pick<HomeTopicView, 'title'>;
  homePreview: Pick<HomeTopicView, 'description' | 'lastAssistantMessage' | 'trigger' | 'userId'>;
  recentNavigation: Pick<HomeTopicView, 'routePath'>;
  routing: Pick<HomeTopicView, 'agentId'>;
  runTiming: Pick<HomeTopicView, 'runStartedAt'>;
  status: Pick<HomeTopicView, 'status'>;
}

export interface HomeTaskFragments {
  assignment: Pick<TaskListItem, 'assigneeAgentId' | 'participants' | 'visibility' | 'workspaceId'>;
  description: Pick<TaskListItem, 'description'>;
  display: Pick<TaskListItem, 'name'>;
  identity: Pick<TaskListItem, 'identifier'>;
  lifecycle: { status: TaskStatus };
}

export interface HomeBriefFragments {
  actions: Pick<BriefItem, 'actions'>;
  content: Pick<BriefItem, 'artifacts' | 'createdAt' | 'priority' | 'summary' | 'title' | 'type'>;
  readState: Pick<BriefItem, 'readAt'>;
  relations: Pick<BriefItem, 'agentId' | 'cronJobId' | 'taskId' | 'topicId' | 'userId'>;
  resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>;
}

export type HomeAgentRecord = EntityRecord<'agent', HomeAgentFragments>;
export type HomeChatGroupRecord = EntityRecord<'chatGroup', HomeChatGroupFragments>;
export type HomeTopicRecord = EntityRecord<'topic', HomeTopicFragments>;
export type HomeTaskRecord = EntityRecord<'task', HomeTaskFragments>;
export type HomeBriefRecord = EntityRecord<'brief', HomeBriefFragments>;

export type HomeEntityRecord =
  HomeAgentRecord | HomeBriefRecord | HomeChatGroupRecord | HomeTaskRecord | HomeTopicRecord;

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

export type HomeEntityIndex =
  | HomeInboxTopicsIndex
  | HomeRecentTopicsIndex
  | HomeSidebarIndex
  | HomeTasksIndex
  | HomeUnresolvedBriefsIndex;

export type HomeSnapshotKey = 'home.dailyBrief';

export interface HomeDailyBriefSnapshot {
  data: HomeDailyBriefResponse;
  key: 'home.dailyBrief';
  observedAt: number;
  source: EntitySource;
}

export type HomeEntitySnapshot = HomeDailyBriefSnapshot;

export interface HomeDataCommit {
  entities?: HomeEntityRecord[];
  indexes?: HomeEntityIndex[];
  snapshots?: HomeEntitySnapshot[];
  tombstones?: EntityTombstone<HomeEntityKind>[];
}

export interface HomeTaskCardView {
  description?: string | null;
  id: string;
  identifier: string;
  name?: string | null;
  status: TaskStatus;
}

export type HomeRecentTopicView = HomeRecentItem & { type: 'topic' };

export interface HomeDataRequestMarker {
  observedAt: number;
}

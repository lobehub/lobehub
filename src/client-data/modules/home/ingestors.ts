import type {
  AgentEntityRecord,
  BriefAction,
  BriefEntityRecord,
  BriefItem,
  BriefType,
  ChatGroupEntityRecord,
  ClientDataCommit,
  ClientDataEntityRecord,
  EntityFragment,
  EntitySource,
  HomeDailyBriefResponse,
  HomeRecentItem,
  HomeRecentTopicsView,
  HomeSidebarEntityRef,
  HomeSidebarGroupIndex,
  HomeTopicView,
  SidebarAgentItem,
  SidebarAgentListResponse,
  SidebarGroup,
  TaskEntityRecord,
  TaskListItem,
  TaskStatus,
  TopicEntityRecord,
} from '@lobechat/types';

export interface EntityObservation {
  observedAt: number;
  source: EntitySource;
}

export type HomeBriefInput = Omit<BriefItem, 'actions' | 'type'> & {
  actions: unknown;
  type: string;
};

const isBriefAction = (value: unknown): value is BriefAction => {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  return (
    typeof action.key === 'string' &&
    typeof action.label === 'string' &&
    (action.type === 'resolve' || action.type === 'comment' || action.type === 'link') &&
    (action.url === undefined || typeof action.url === 'string')
  );
};

const parseBriefActions = (value: unknown): BriefAction[] | null => {
  if (value === null) return null;
  if (Array.isArray(value) && value.every(isBriefAction)) return value;
  throw new TypeError('Invalid Brief actions payload');
};

const parseBriefType = (value: string): BriefType => {
  if (value === 'decision' || value === 'error' || value === 'insight' || value === 'result') {
    return value;
  }
  throw new TypeError('Invalid Brief type payload');
};

const parseTaskStatus = (value: string): TaskStatus => {
  if (
    value === 'backlog' ||
    value === 'canceled' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'paused' ||
    value === 'running' ||
    value === 'scheduled'
  ) {
    return value;
  }
  throw new TypeError('Invalid Task status payload');
};

const fragment = <T>(data: T, observation: EntityObservation): EntityFragment<T> => ({
  data,
  ...observation,
});

const sidebarRecord = (
  item: SidebarAgentItem,
  observation: EntityObservation,
): AgentEntityRecord | ChatGroupEntityRecord => {
  if (item.type === 'group') {
    return {
      fragments: {
        access: fragment({ userId: item.userId, visibility: item.visibility }, observation),
        identity: fragment(
          {
            avatar: item.avatar,
            backgroundColor: item.backgroundColor,
            description: item.description,
            groupAvatar: item.groupAvatar,
            title: item.title,
          },
          observation,
        ),
      },
      id: item.id,
      kind: 'chatGroup',
    };
  }

  return {
    fragments: {
      access: fragment({ userId: item.userId, visibility: item.visibility }, observation),
      identity: fragment(
        {
          avatar: item.avatar,
          backgroundColor: item.backgroundColor,
          name: item.name,
          title: item.title,
        },
        observation,
      ),
      profile: fragment({ description: item.description, slug: item.slug }, observation),
      routing: fragment({ sessionId: item.sessionId }, observation),
      runtime: fragment({ heterogeneousType: item.heterogeneousType }, observation),
    },
    id: item.id,
    kind: 'agent',
  };
};

const sidebarRef = (item: SidebarAgentItem): HomeSidebarEntityRef => ({
  id: item.id,
  kind: item.type === 'group' ? 'chatGroup' : 'agent',
  pinned: item.pinned,
  unreadCount: item.unreadCount,
  updatedAt: item.updatedAt,
});

const sidebarGroup = (group: SidebarGroup): HomeSidebarGroupIndex => ({
  id: group.id,
  items: group.items.map(sidebarRef),
  name: group.name,
  sort: group.sort,
  visibility: group.visibility,
});

export const ingestHomeSidebar = (
  response: SidebarAgentListResponse,
  observation: EntityObservation,
): ClientDataCommit => {
  const buckets = [
    response.pinned,
    response.groups.flatMap((group) => group.items),
    response.ungrouped,
    response.privatePinned ?? [],
    (response.privateGroups ?? []).flatMap((group) => group.items),
    response.privateUngrouped ?? [],
  ];
  const unique = new Map<string, SidebarAgentItem>();
  for (const item of buckets.flat()) unique.set(`${item.type}:${item.id}`, item);

  return {
    entities: Array.from(unique.values(), (item) => sidebarRecord(item, observation)),
    indexes: [
      {
        groups: response.groups.map(sidebarGroup),
        key: 'home.sidebar',
        ...observation,
        pinned: response.pinned.map(sidebarRef),
        privateGroups: (response.privateGroups ?? []).map(sidebarGroup),
        privatePinned: (response.privatePinned ?? []).map(sidebarRef),
        privateUngrouped: (response.privateUngrouped ?? []).map(sidebarRef),
        ungrouped: response.ungrouped.map(sidebarRef),
      },
    ],
  };
};

const recentTopicRecord = (
  item: HomeRecentItem,
  observation: EntityObservation,
): TopicEntityRecord => ({
  fragments: {
    activity: fragment({ updatedAt: item.updatedAt }, observation),
    display: fragment({ title: item.title }, observation),
    navigation: fragment({ routePath: item.routePath }, observation),
    preview: fragment(
      {
        description: item.description,
        lastAssistantMessage: item.lastAssistantMessage,
        userId: item.userId,
      },
      observation,
    ),
    routing: fragment({ agentId: item.agentId }, observation),
  },
  id: item.id,
  kind: 'topic',
});

export const ingestHomeRecentTopics = (
  items: HomeRecentItem[],
  limit: number,
  view: HomeRecentTopicsView,
  observation: EntityObservation,
): ClientDataCommit => {
  const topics = items.filter(
    (item): item is HomeRecentItem & { type: 'topic' } => item.type === 'topic',
  );

  return {
    entities: topics.map((item) => recentTopicRecord(item, observation)),
    indexes: [
      {
        key: 'home.recentTopics',
        ...observation,
        limit,
        refs: topics.map(({ id }) => ({ id, kind: 'topic' as const })),
        view,
      },
    ],
  };
};

const inboxTopicRecord = (
  item: HomeTopicView,
  observation: EntityObservation,
): TopicEntityRecord => ({
  fragments: {
    activity: fragment({ updatedAt: item.updatedAt }, observation),
    ...(item.createdAt ? { creation: fragment({ createdAt: item.createdAt }, observation) } : {}),
    display: fragment({ title: item.title }, observation),
    preview: fragment(
      {
        lastAssistantMessage: item.lastAssistantMessage,
        trigger: item.trigger,
        userId: item.userId,
      },
      observation,
    ),
    routing: fragment({ agentId: item.agentId }, observation),
    runTiming: fragment({ runStartedAt: item.runStartedAt }, observation),
    status: fragment({ status: item.status }, observation),
  },
  id: item.id,
  kind: 'topic',
});

export const ingestHomeInboxTopics = (
  items: HomeTopicView[],
  observation: EntityObservation,
): ClientDataCommit => ({
  entities: items.map((item) => inboxTopicRecord(item, observation)),
  indexes: [
    {
      key: 'home.inboxTopics',
      ...observation,
      refs: items.map(({ id }) => ({ id, kind: 'topic' as const })),
    },
  ],
});

const agentIdentityRecord = (
  agent: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    name?: string | null;
    title: string | null;
  },
  observation: EntityObservation,
): AgentEntityRecord => ({
  fragments: {
    identity: fragment(
      {
        avatar: agent.avatar,
        backgroundColor: agent.backgroundColor,
        name: agent.name,
        title: agent.title,
      },
      observation,
    ),
  },
  id: agent.id,
  kind: 'agent',
});

const taskRecord = (item: TaskListItem, observation: EntityObservation): TaskEntityRecord => ({
  fragments: {
    assignment: fragment(
      {
        assigneeAgentId: item.assigneeAgentId,
        participants: item.participants,
        visibility: item.visibility,
        workspaceId: item.workspaceId,
      },
      observation,
    ),
    description: fragment({ description: item.description }, observation),
    display: fragment({ name: item.name }, observation),
    identity: fragment({ identifier: item.identifier }, observation),
    lifecycle: fragment({ status: parseTaskStatus(item.status) }, observation),
  },
  id: item.id,
  kind: 'task',
});

export const ingestHomeTasks = (
  items: TaskListItem[],
  total: number,
  observation: EntityObservation,
): ClientDataCommit => {
  const participantAgents = new Map<
    string,
    { avatar: string | null; backgroundColor: string | null; id: string; title: string | null }
  >();
  for (const task of items) {
    for (const participant of task.participants) {
      if (participant.type !== 'agent') continue;
      participantAgents.set(participant.id, participant);
    }
  }

  return {
    entities: [
      ...items.map((item) => taskRecord(item, observation)),
      ...Array.from(participantAgents.values(), (agent) => agentIdentityRecord(agent, observation)),
    ],
    indexes: [
      {
        key: 'home.tasks',
        ...observation,
        refs: items.map(({ id }) => ({ id, kind: 'task' as const })),
        total,
      },
    ],
  };
};

const briefRecord = (item: HomeBriefInput, observation: EntityObservation): BriefEntityRecord => ({
  fragments: {
    actions: fragment({ actions: parseBriefActions(item.actions) }, observation),
    content: fragment(
      {
        artifacts: item.artifacts,
        createdAt: item.createdAt,
        priority: item.priority,
        summary: item.summary,
        title: item.title,
        type: parseBriefType(item.type),
      },
      observation,
    ),
    readState: fragment({ readAt: item.readAt }, observation),
    relations: fragment(
      {
        agentId: item.agentId,
        cronJobId: item.cronJobId,
        taskId: item.taskId,
        topicId: item.topicId,
        userId: item.userId,
      },
      observation,
    ),
    resolution: fragment(
      {
        resolvedAction: item.resolvedAction,
        resolvedAt: item.resolvedAt,
        resolvedComment: item.resolvedComment,
      },
      observation,
    ),
  },
  id: item.id,
  kind: 'brief',
});

const briefTaskRecords = (
  item: HomeBriefInput,
  observation: EntityObservation,
): TaskEntityRecord[] => {
  if (!item.taskId) return [];

  const fragments: TaskEntityRecord['fragments'] = {};
  if (item.taskIdentifier) {
    fragments.identity = fragment({ identifier: item.taskIdentifier }, observation);
  }
  if (item.taskName !== undefined) {
    fragments.display = fragment({ name: item.taskName }, observation);
  }
  if (item.taskStatus) {
    fragments.lifecycle = fragment({ status: item.taskStatus }, observation);
  }
  if (Object.keys(fragments).length === 0) return [];

  return [{ fragments, id: item.taskId, kind: 'task' }];
};

export const ingestHomeBriefs = (
  items: HomeBriefInput[],
  observation: EntityObservation,
): ClientDataCommit => {
  const entities: ClientDataEntityRecord[] = [];
  for (const item of items) {
    entities.push(briefRecord(item, observation));
    if (item.agent) entities.push(agentIdentityRecord(item.agent, observation));
    entities.push(...briefTaskRecords(item, observation));
  }

  return {
    entities,
    indexes: [
      {
        key: 'home.unresolvedBriefs',
        ...observation,
        refs: items.map(({ id }) => ({ id, kind: 'brief' as const })),
      },
    ],
  };
};

export const ingestHomeDailyBrief = (
  data: HomeDailyBriefResponse,
  observation: EntityObservation,
): ClientDataCommit => ({
  snapshots: [{ data, key: 'home.dailyBrief', ...observation }],
});

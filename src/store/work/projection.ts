import type {
  ListedWorkType,
  WorkListItem,
  WorkSkillProvider,
  WorkSummaryItem,
  WorkVersionItem,
  WorkVisibility,
} from '@lobechat/types';

import { definePagedReplica, defineReplica } from '@/libs/replica';
import { workKeys } from '@/libs/swr/keys';

import type { WorkspaceWorksData } from './initialState';

/** Head page size of the workspace Work gallery. */
export const WORKSPACE_WORKS_PAGE_SIZE = 30;

/** Cards the project dashboard shows for its coordinator agent. */
export const AGENT_WORKS_LIMIT = 4;

export interface WorkspaceWorksParams {
  provider?: WorkSkillProvider;
  type?: ListedWorkType;
  visibility?: WorkVisibility;
  /** Only shapes the SWR sync key; the replica scope already partitions by workspace. */
  workspaceId: string | null;
}

/** Entry key of one gallery filter (`workspaceWorksMap[key]`). */
export const workspaceWorksKey = ({ provider, type, visibility }: WorkspaceWorksParams): string =>
  `${type ?? '*'}|${provider ?? '*'}|${visibility ?? '*'}`;

/**
 * The cross-topic Work gallery (resource home recent works, /resource/works),
 * one local-first entry per filter. The server pages by an opaque cursor,
 * newest first; a reload repaints the head page while the network confirms.
 *
 * The sync adopts the `work:workspace` key so Work mutations that refresh the
 * `work:` domain (`workService.refreshAll` / `refreshWorkspaceLists`) reach it.
 */
export const workspaceWorksResource = definePagedReplica<
  WorkspaceWorksParams,
  WorkSummaryItem,
  string,
  WorkspaceWorksData
>({
  key: workspaceWorksKey,
  name: 'workspaceWorks',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'cursor',
    persist: { pages: 1 },
  },
  // Types × providers × visibility are a handful of filters; the cap only
  // guards against filter keys a later release adds.
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  syncKey: (params) =>
    workKeys.workspace(params.workspaceId, workspaceWorksKey(params), undefined, params.visibility),
  version: 1,
});

export interface AgentWorksParams {
  originAgentId: string;
  workspaceId: string | null;
}

/**
 * The latest Works one agent produced — the project dashboard's "latest works"
 * for its coordinator agent. A short fixed-size list per agent.
 */
export const agentWorksResource = defineReplica<AgentWorksParams, WorkSummaryItem[]>({
  key: ({ originAgentId }) => originAgentId,
  name: 'agentWorks',
  persist: { maxEntries: 50 },
  storage: 'indexedDB',
  syncKey: ({ originAgentId, workspaceId }) =>
    workKeys.workspace(workspaceId, `agent:${originAgentId}:${AGENT_WORKS_LIMIT}`),
  version: 1,
});

export interface ConversationWorksParams {
  threadId?: string | null;
  topicId: string;
}

/** Entry key of one conversation's Work history (`conversationWorksMap[key]`). */
export const conversationWorksKey = ({ threadId, topicId }: ConversationWorksParams): string =>
  `${topicId}|${threadId ?? ''}`;

/**
 * The working sidebar's Work history of one conversation (topic + thread).
 * Persisted for the most recent conversations only.
 *
 * The sync adopts `work:conversation`, which the runtime transports revalidate
 * once per operation end (`workService.refreshConversationViews`).
 */
export const conversationWorksResource = defineReplica<ConversationWorksParams, WorkListItem[]>({
  key: conversationWorksKey,
  name: 'conversationWorks',
  persist: { maxEntries: 100 },
  storage: 'indexedDB',
  syncKey: ({ threadId, topicId }) => workKeys.conversation(topicId, threadId ?? null),
  version: 1,
});

export interface WorkVersionsParams {
  workId: string;
}

/**
 * The version timeline of one Work (expanded history card). The sync adopts
 * `work:versions`, revalidated with the conversation views. Persisted slim
 * (no captured `content`) for the most recently expanded Works.
 */
export const workVersionsResource = defineReplica<WorkVersionsParams, WorkVersionItem[]>({
  key: ({ workId }) => workId,
  name: 'workVersions',
  persist: { maxEntries: 200 },
  storage: 'indexedDB',
  syncKey: ({ workId }) => workKeys.versions(workId),
  version: 1,
});

/** The timeline never renders a version's captured text, so it is not persisted. */
export const toPersistedVersions = (versions: WorkVersionItem[]): WorkVersionItem[] =>
  versions.map((version) => (version.content === null ? version : { ...version, content: null }));

import type { WorkState } from './initialState';
import {
  conversationWorksKey,
  type ConversationWorksParams,
  workspaceWorksKey,
  type WorkspaceWorksParams,
} from './projection';

/** Every getter returns `undefined` until the entry first paints (storage or network). */
const workspaceWorks = (params: WorkspaceWorksParams) => (s: WorkState) =>
  s.workspaceWorksMap[workspaceWorksKey(params)];

const agentWorks = (originAgentId: string | null | undefined) => (s: WorkState) =>
  originAgentId ? s.agentWorksMap[originAgentId] : undefined;

const conversationWorks = (params: ConversationWorksParams | null) => (s: WorkState) =>
  params ? s.conversationWorksMap[conversationWorksKey(params)] : undefined;

const workVersions = (workId: string) => (s: WorkState) => s.workVersionsMap[workId];

const topicPullRequests = (topicId: string | null | undefined) => (s: WorkState) =>
  topicId ? s.topicPullRequestsMap[topicId] : undefined;

export const workSelectors = {
  agentWorks,
  conversationWorks,
  topicPullRequests,
  workspaceWorks,
  workVersions,
};

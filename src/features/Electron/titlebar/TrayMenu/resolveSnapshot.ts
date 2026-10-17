import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL } from '@lobechat/const';
import type { TrayNavigationSnapshot } from '@lobechat/electron-client-ipc';
import { agentDisplayName, type RecentItem } from '@lobechat/types';

import type { SidebarAgentItem } from '@/database/repositories/home';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

import type { ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import type { TabScope } from '../TabBar/scope';
import type { ActiveTopic } from './selectActiveTopics';

interface ResolveTrayNavigationSnapshotParams {
  activeTopics?: ActiveTopic[];
  agents: SidebarAgentItem[];
  pinnedPages: ResolvedTab[];
  recentPages: ResolvedTab[];
  recents?: RecentItem[];
  scope: TabScope;
}

const timestamp = (value: Date | string | null | undefined) =>
  value ? new Date(value).getTime() : 0;

const getAgentIdFromUrl = (url: string): string | undefined => {
  const pathname = new URL(url, 'https://lobehub.local').pathname;
  const segments = pathname.split('/').filter(Boolean);
  const agentIndex = segments.indexOf('agent');
  const encodedId = agentIndex >= 0 ? segments[agentIndex + 1] : undefined;

  return encodedId ? decodeURIComponent(encodedId) : undefined;
};

const scopedPath = (scope: TabScope, path: string) =>
  scope.type === 'workspace' ? `/${encodeURIComponent(scope.slug)}${path}` : path;

const fallbackAgentUrl = (scope: TabScope, agentId: string) =>
  scopedPath(scope, `/agent/${encodeURIComponent(agentId)}`);

const activeTopicUrl = (scope: TabScope, { agentId, groupId, topicId }: ActiveTopic) =>
  scopedPath(
    scope,
    groupId
      ? GROUP_CHAT_TOPIC_URL(encodeURIComponent(groupId), encodeURIComponent(topicId))
      : AGENT_CHAT_TOPIC_URL(encodeURIComponent(agentId ?? ''), encodeURIComponent(topicId)),
  );

const recentRoute = (item: RecentItem) =>
  item.type === 'task'
    ? taskDetailPath(item.id, item.agentId ?? undefined, item.slugTitle)
    : item.routePath;

export const resolveTrayNavigationSnapshot = ({
  activeTopics = [],
  agents,
  pinnedPages,
  recentPages,
  recents = [],
  scope,
}: ResolveTrayNavigationSnapshotParams): TrayNavigationSnapshot => {
  const uniqueAgents = new Map<string, SidebarAgentItem>();
  const sortedAgents = [...agents].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  for (const agent of sortedAgents) {
    if (!uniqueAgents.has(agent.id)) uniqueAgents.set(agent.id, agent);
  }
  const agentNames = new Map(
    [...uniqueAgents.values()].map((agent) => [agent.id, agentDisplayName(agent, 'Untitled')]),
  );

  const visitedPages = [...pinnedPages, ...recentPages].sort(
    (a, b) => b.tab.lastVisited - a.tab.lastVisited,
  );

  const active = activeTopics
    .toSorted(
      (a, b) => Number(b.status === 'waitingForHuman') - Number(a.status === 'waitingForHuman'),
    )
    .map((topic) => ({
      status: topic.status,
      subtitle: agentNames.get(topic.groupId ?? topic.agentId ?? ''),
      title: topic.title || 'Untitled',
      url: activeTopicUrl(scope, topic),
    }));
  const activeTopicIds = new Set(activeTopics.map(({ topicId }) => topicId));
  const workspaceSlug = scope.type === 'workspace' ? scope.slug : undefined;

  return {
    activeTopics: active,
    agents: [...uniqueAgents.values()].map((agent) => ({
      id: agent.id,
      title: agentDisplayName(agent, 'Untitled'),
      url:
        visitedPages.find((page) => getAgentIdFromUrl(page.tab.url) === agent.id)?.tab.url ??
        fallbackAgentUrl(scope, agent.id),
    })),
    pinned: pinnedPages.map(({ meta, tab }) => ({ title: meta.title, url: tab.url })),
    recent: recents
      .filter((item) => !(item.type === 'topic' && activeTopicIds.has(item.id)))
      .map((item) => ({
        subtitle: item.agentId ? agentNames.get(item.agentId) : undefined,
        title: item.title || 'Untitled',
        url: buildWorkspaceAwarePath(recentRoute(item), workspaceSlug),
      })),
  };
};

import type { TrayNavigationSnapshot } from '@lobechat/electron-client-ipc';

import type { SidebarAgentItem } from '@/database/repositories/home';

import type { ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import type { TabScope } from '../TabBar/scope';

interface ResolveTrayNavigationSnapshotParams {
  agents: SidebarAgentItem[];
  pinnedPages: ResolvedTab[];
  recentPages: ResolvedTab[];
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

const fallbackAgentUrl = (scope: TabScope, agentId: string) => {
  const prefix = scope.type === 'workspace' ? `/${encodeURIComponent(scope.slug)}` : '';
  return `${prefix}/agent/${encodeURIComponent(agentId)}`;
};

export const resolveTrayNavigationSnapshot = ({
  agents,
  pinnedPages,
  recentPages,
  scope,
}: ResolveTrayNavigationSnapshotParams): TrayNavigationSnapshot => {
  const uniqueAgents = new Map<string, SidebarAgentItem>();
  const sortedAgents = [...agents].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  for (const agent of sortedAgents) {
    if (!uniqueAgents.has(agent.id)) uniqueAgents.set(agent.id, agent);
  }

  const visitedPages = [...pinnedPages, ...recentPages].sort(
    (a, b) => b.tab.lastVisited - a.tab.lastVisited,
  );

  return {
    agents: [...uniqueAgents.values()].map((agent) => ({
      id: agent.id,
      title: agent.title || 'Untitled',
      url:
        visitedPages.find((page) => getAgentIdFromUrl(page.tab.url) === agent.id)?.tab.url ??
        fallbackAgentUrl(scope, agent.id),
    })),
    pinned: pinnedPages.map(({ meta, tab }) => ({ title: meta.title, url: tab.url })),
    recent: recentPages.map(({ meta, tab }) => ({ title: meta.title, url: tab.url })),
  };
};

import type { RecentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { SidebarAgentItem } from '@/database/repositories/home';

import type { ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import { resolveTrayNavigationSnapshot } from './resolveSnapshot';

const page = (title: string, url: string, lastVisited: number): ResolvedTab => ({
  isActive: false,
  meta: { title },
  tab: { cached: { title }, id: url, lastVisited, url },
});

const recent = (item: Partial<RecentItem>): RecentItem => ({
  icon: item.type ?? 'document',
  id: 'id',
  routePath: '/',
  status: null,
  title: '',
  type: 'document',
  updatedAt: new Date(0),
  ...item,
});

const agent = (id: string, title: string, updatedAt: string): SidebarAgentItem =>
  ({ id, pinned: false, title, type: 'agent', updatedAt }) as unknown as SidebarAgentItem;

describe('resolveTrayNavigationSnapshot', () => {
  it('sorts and deduplicates recent agents while preferring their latest visited route', () => {
    const snapshot = resolveTrayNavigationSnapshot({
      agents: [
        agent('agent-1', 'Older duplicate', '2026-07-09T00:00:00.000Z'),
        agent('agent-2', 'Writer', '2026-07-10T00:00:00.000Z'),
        agent('agent-1', 'Researcher', '2026-07-11T00:00:00.000Z'),
        agent('agent-3', 'Planner', '2026-07-08T00:00:00.000Z'),
        agent('agent-4', 'Reviewer', '2026-07-07T00:00:00.000Z'),
      ],
      pinnedPages: [],
      recentPages: [
        page('Old Agent Route', '/acme/agent/agent-1/topic-old', 10),
        page('Latest Agent Route', '/acme/agent/agent-1/topic-latest', 20),
      ],
      scope: { slug: 'acme', type: 'workspace' },
    });

    expect(snapshot.agents.slice(0, 3)).toEqual([
      { id: 'agent-1', title: 'Researcher', url: '/acme/agent/agent-1/topic-latest' },
      { id: 'agent-2', title: 'Writer', url: '/acme/agent/agent-2' },
      { id: 'agent-3', title: 'Planner', url: '/acme/agent/agent-3' },
    ]);
    expect(snapshot.agents).toHaveLength(4);
  });

  it('builds recent entries from the sidebar recents with workspace-aware links', () => {
    const snapshot = resolveTrayNavigationSnapshot({
      agents: [agent('agent-1', 'Researcher', '2026-07-11T00:00:00.000Z')],
      pinnedPages: [],
      recentPages: [],
      recents: [
        recent({
          agentId: 'agent-1',
          id: 'topic-1',
          routePath: '/agent/agent-1/topic-1',
          title: 'Topic title',
          type: 'topic',
        }),
        recent({ id: 'doc-1', routePath: '/page/doc-1', title: '', type: 'document' }),
        recent({
          agentId: 'agent-1',
          id: 'task-1',
          routePath: '/agent/agent-1/task/task-1',
          slugTitle: 'Ship it',
          title: 'Ship it',
          type: 'task',
        }),
      ],
      scope: { slug: 'acme', type: 'workspace' },
    });

    expect(snapshot.recent).toEqual([
      { subtitle: 'Researcher', title: 'Topic title', url: '/acme/agent/agent-1/topic-1' },
      { subtitle: undefined, title: 'Untitled', url: '/acme/page/doc-1' },
      {
        subtitle: 'Researcher',
        title: 'Ship it',
        url: '/acme/agent/agent-1/task/task-1/ship-it',
      },
    ]);
  });

  it('uses personal fallback routes and preserves overflow for More actions', () => {
    const snapshot = resolveTrayNavigationSnapshot({
      agents: [agent('agent 1', '', '2026-07-11T00:00:00.000Z')],
      pinnedPages: Array.from({ length: 4 }, (_, index) =>
        page(`Pinned ${index}`, `/page/pinned-${index}`, index),
      ),
      recentPages: [],
      recents: Array.from({ length: 6 }, (_, index) =>
        recent({ id: `doc-${index}`, routePath: `/page/doc-${index}`, title: `Recent ${index}` }),
      ),
      scope: { type: 'personal' },
    });

    expect(snapshot.agents[0]).toEqual({
      id: 'agent 1',
      title: 'Untitled',
      url: '/agent/agent%201',
    });
    expect(snapshot.pinned).toHaveLength(4);
    expect(snapshot.recent).toHaveLength(6);
  });

  it('routes active topics by owner, lists awaiting input first, and drops them from recent', () => {
    const snapshot = resolveTrayNavigationSnapshot({
      activeTopics: [
        { agentId: 'agent-1', status: 'running', title: 'Refactor', topicId: 'topic-1' },
        { groupId: 'group-1', status: 'waitingForHuman', title: '', topicId: 'topic-2' },
      ],
      agents: [agent('agent-1', 'Researcher', '2026-07-11T00:00:00.000Z')],
      pinnedPages: [],
      recentPages: [],
      recents: [
        recent({
          id: 'topic-1',
          routePath: '/agent/agent-1/topic-1',
          title: 'Refactor',
          type: 'topic',
        }),
        recent({
          id: 'topic-3',
          routePath: '/agent/agent-1/topic-3',
          title: 'Other',
          type: 'topic',
        }),
      ],
      scope: { slug: 'acme', type: 'workspace' },
    });

    expect(snapshot.activeTopics).toEqual([
      {
        status: 'waitingForHuman',
        subtitle: undefined,
        title: 'Untitled',
        url: '/acme/group/group-1/topic-2',
      },
      {
        status: 'running',
        subtitle: 'Researcher',
        title: 'Refactor',
        url: '/acme/agent/agent-1/topic-1',
      },
    ]);
    expect(snapshot.recent.map(({ url }) => url)).toEqual(['/acme/agent/agent-1/topic-3']);
  });
});

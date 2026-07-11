import { describe, expect, it } from 'vitest';

import type { SidebarAgentItem } from '@/database/repositories/home';

import type { ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import { resolveTrayNavigationSnapshot } from './resolveSnapshot';

const page = (title: string, url: string, lastVisited: number): ResolvedTab => ({
  isActive: false,
  meta: { title },
  tab: { id: url, lastVisited, url },
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

  it('keeps only concrete topics and pages with a descriptive second line', () => {
    const snapshot = resolveTrayNavigationSnapshot({
      agents: [agent('agent-1', 'Researcher', '2026-07-11T00:00:00.000Z')],
      pinnedPages: [],
      recentPages: [
        page('Topic title · Researcher', '/agent/agent-1/topic-1', 5),
        page('Page title', '/page/page-1', 4),
        page('Agent root', '/agent/agent-1', 3),
        page('Agent task', '/agent/agent-1/task/task-1', 3),
        page('Page list', '/page', 2),
        page('Settings', '/settings', 1),
      ],
      scope: { type: 'personal' },
    });

    expect(snapshot.recent).toEqual([
      { subtitle: 'Researcher', title: 'Topic title', url: '/agent/agent-1/topic-1' },
      { subtitle: 'Page', title: 'Page title', url: '/page/page-1' },
    ]);
  });

  it('uses personal fallback routes and preserves overflow for More actions', () => {
    const snapshot = resolveTrayNavigationSnapshot({
      agents: [agent('agent 1', '', '2026-07-11T00:00:00.000Z')],
      pinnedPages: Array.from({ length: 4 }, (_, index) =>
        page(`Pinned ${index}`, `/page/pinned-${index}`, index),
      ),
      recentPages: Array.from({ length: 6 }, (_, index) =>
        page(`Recent ${index}`, `/page/recent-${index}`, index),
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
});

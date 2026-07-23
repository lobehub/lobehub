import { describe, expect, it } from 'vitest';

import { type HomeStore } from '@/store/home/store';

import { homeAgentListSelectors } from './selectors';

const createState = (overrides: Partial<HomeStore>): HomeStore =>
  ({
    agentGroups: [],
    pinnedAgents: [],
    privateAgentGroups: [],
    privatePinnedAgents: [],
    privateUngroupedAgents: [],
    ungroupedAgents: [],
    ...overrides,
  }) as HomeStore;

const agent = (id: string) => ({
  id,
  pinned: true,
  title: id,
  type: 'agent' as const,
  updatedAt: new Date(),
});

describe('homeAgentListSelectors - private pinned', () => {
  it('privatePinnedAgents returns the private pinned bucket', () => {
    const state = createState({ privatePinnedAgents: [agent('a1')] });
    expect(homeAgentListSelectors.privatePinnedAgents(state)).toEqual([agent('a1')]);
  });

  it('hasPrivateAgents is true when the only private item is pinned', () => {
    const state = createState({ privatePinnedAgents: [agent('a1')] });
    expect(homeAgentListSelectors.hasPrivateAgents(state)).toBe(true);
  });

  it('allAgents includes private pinned items', () => {
    const state = createState({ privatePinnedAgents: [agent('a1')] });
    expect(homeAgentListSelectors.allAgents(state).map((a) => a.id)).toContain('a1');
  });
});

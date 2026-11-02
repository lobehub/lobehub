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

// Fixed timestamp: two `new Date()` calls can land on different milliseconds,
// making `toEqual([agent('a1')])` flaky when re-invoked in the assertion.
const FIXED_UPDATED_AT = new Date('2026-01-01T00:00:00.000Z');

const agent = (id: string) => ({
  id,
  pinned: true,
  title: id,
  type: 'agent' as const,
  updatedAt: FIXED_UPDATED_AT,
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

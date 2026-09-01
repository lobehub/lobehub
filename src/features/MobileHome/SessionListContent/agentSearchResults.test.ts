import type { SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getVisibleAgentSearchResults } from './agentSearchResults';

const createSearchResult = (overrides: Partial<SidebarAgentItem> = {}): SidebarAgentItem => ({
  id: 'agent-1',
  pinned: false,
  title: 'Social Agent',
  type: 'agent',
  updatedAt: new Date('2026-08-29T00:00:00.000Z'),
  ...overrides,
});

describe('getVisibleAgentSearchResults', () => {
  it('keeps mobile agent results that do not have a legacy session', () => {
    const agentWithoutSession = createSearchResult({ sessionId: undefined });

    expect(getVisibleAgentSearchResults([agentWithoutSession], true)).toEqual([
      agentWithoutSession,
    ]);
  });

  it('hides chat groups only on the mobile home', () => {
    const agent = createSearchResult();
    const group = createSearchResult({ id: 'group-1', type: 'group' });

    expect(getVisibleAgentSearchResults([agent, group], true)).toEqual([agent]);
    expect(getVisibleAgentSearchResults([agent, group], false)).toEqual([agent, group]);
  });
});

import type { SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildMoveTargets } from './targets';

const agent = (id: string, title = id, type: 'agent' | 'group' = 'agent'): SidebarAgentItem => ({
  avatar: null,
  description: null,
  id,
  pinned: false,
  title,
  type,
  updatedAt: new Date(),
});

const empty = {
  agentGroups: [],
  pinnedAgents: [],
  privateAgentGroups: [],
  privatePinnedAgents: [],
  privateUngroupedAgents: [],
  ungroupedAgents: [],
};

describe('buildMoveTargets', () => {
  it('returns private agents from every private bucket', () => {
    const result = buildMoveTargets({
      ...empty,
      privateAgentGroups: [{ id: 'g', items: [agent('pg')], title: 'G' } as any],
      privatePinnedAgents: [agent('pp')],
      privateUngroupedAgents: [agent('pu')],
      ungroupedAgents: [agent('w1')],
    });

    expect(result.privateAgents.map((a) => a.id)).toEqual(['pp', 'pg', 'pu']);
    expect(result.workspaceAgents.map((a) => a.id)).toEqual(['w1']);
  });

  it('excludes the source agent, chat groups and non-matching search results', () => {
    const result = buildMoveTargets({
      ...empty,
      privateUngroupedAgents: [agent('src'), agent('p1', 'Alpha'), agent('grp', 'Alpha', 'group')],
      search: 'alp',
      sourceAgentId: 'src',
      ungroupedAgents: [agent('w1', 'Beta')],
    });

    expect(result.privateAgents.map((a) => a.id)).toEqual(['p1']);
    expect(result.workspaceAgents).toEqual([]);
  });

  it('prepends the inbox agent to the workspace bucket only when missing', () => {
    const inbox = agent('inbox', 'LobeAI');
    expect(
      buildMoveTargets({ ...empty, inbox, ungroupedAgents: [agent('w1')] }).workspaceAgents.map(
        (a) => a.id,
      ),
    ).toEqual(['inbox', 'w1']);
    expect(
      buildMoveTargets({ ...empty, inbox, ungroupedAgents: [inbox] }).workspaceAgents.map(
        (a) => a.id,
      ),
    ).toEqual(['inbox']);
  });
});

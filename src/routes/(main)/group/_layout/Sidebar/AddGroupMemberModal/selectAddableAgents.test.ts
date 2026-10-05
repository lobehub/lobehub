import { describe, expect, it } from 'vitest';

import { selectAddableAgents } from './selectAddableAgents';

describe('selectAddableAgents', () => {
  it('excludes the inbox, which addAgentsToGroup refuses', () => {
    const agents = [
      { id: 'inbox', isInbox: true },
      { id: 'a1', isInbox: false },
    ];

    expect(selectAddableAgents(agents, []).map((a) => a.id)).toEqual(['a1']);
  });

  it('excludes agents that are already members', () => {
    const agents = [
      { id: 'a1', isInbox: false },
      { id: 'a2', isInbox: false },
    ];

    expect(selectAddableAgents(agents, ['a1']).map((a) => a.id)).toEqual(['a2']);
  });
});

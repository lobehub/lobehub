import { describe, expect, it } from 'vitest';

import { goalAgentFilterOptions, matchGoalAgentFilterOptions } from './goalAgentFilterOptions';

describe('goalAgentFilterOptions', () => {
  it('lists each agent once, in first-appearance order, with its goal count', () => {
    const goals = [
      { goal: { agentId: 'agt-b' } },
      { goal: { agentId: 'agt-a' } },
      { goal: { agentId: 'agt-b' } },
    ];

    expect(goalAgentFilterOptions(goals)).toEqual([
      { agentId: 'agt-b', count: 2 },
      { agentId: 'agt-a', count: 1 },
    ]);
  });

  it('leaves out goals with no agent', () => {
    expect(goalAgentFilterOptions([{ goal: { agentId: null } }, { goal: {} }])).toEqual([]);
  });
});

describe('matchGoalAgentFilterOptions', () => {
  const options = [
    { agentId: 'agt-a', count: 2 },
    { agentId: 'agt-b', count: 1 },
  ];
  const titles = { 'agt-a': '目标验收助手', 'agt-b': 'Lobe AI' };

  it('keeps every option for an empty search', () => {
    expect(matchGoalAgentFilterOptions(options, titles, '  ')).toEqual(options);
  });

  it('matches the agent name case-insensitively', () => {
    expect(matchGoalAgentFilterOptions(options, titles, 'lobe')).toEqual([options[1]]);
    expect(matchGoalAgentFilterOptions(options, titles, '验收')).toEqual([options[0]]);
  });

  it('returns nothing when no name matches', () => {
    expect(matchGoalAgentFilterOptions(options, titles, 'zzz')).toEqual([]);
  });
});

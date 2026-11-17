import { describe, expect, it } from 'vitest';

import {
  groupCheckState,
  groupMovableTopics,
  type MovableTopic,
  toggleGroup,
  toggleTopic,
} from './movableTopicGroups';

const topic = (id: string, agentId: string | null, title = id): MovableTopic => ({
  agentAvatar: null,
  agentBackgroundColor: null,
  agentId,
  agentTitle: agentId ? `Agent ${agentId}` : null,
  id,
  title,
  updatedAt: new Date(0),
});

describe('groupMovableTopics', () => {
  it('groups by agent in first-seen order and drops agentless rows', () => {
    const groups = groupMovableTopics([
      topic('t1', 'b'),
      topic('t2', 'a'),
      topic('t3', 'b'),
      topic('t4', null),
    ]);
    expect(groups.map((g) => [g.agentId, g.topics.map((t) => t.id)])).toEqual([
      ['b', ['t1', 't3']],
      ['a', ['t2']],
    ]);
  });

  it('filters by a case-insensitive title keyword and drops emptied groups', () => {
    const groups = groupMovableTopics(
      [topic('t1', 'a', 'Release Notes'), topic('t2', 'b', 'Lunch')],
      ' release ',
    );
    expect(groups.map((g) => g.agentId)).toEqual(['a']);
  });
});

describe('group selection', () => {
  const [group] = groupMovableTopics([topic('t1', 'a'), topic('t2', 'a')]);

  it('reports none / some / all', () => {
    expect(groupCheckState(group, new Set())).toBe('none');
    expect(groupCheckState(group, new Set(['t1']))).toBe('some');
    expect(groupCheckState(group, new Set(['t1', 't2', 'other']))).toBe('all');
  });

  it('selects the whole group, then clears it, leaving other selections alone', () => {
    const all = toggleGroup(group, new Set(['t1', 'other']));
    expect([...all].sort()).toEqual(['other', 't1', 't2']);
    expect([...toggleGroup(group, all)]).toEqual(['other']);
  });

  it('toggles a single topic', () => {
    expect([...toggleTopic('t1', new Set())]).toEqual(['t1']);
    expect([...toggleTopic('t1', new Set(['t1']))]).toEqual([]);
  });
});

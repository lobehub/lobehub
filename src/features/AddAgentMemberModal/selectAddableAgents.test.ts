import { describe, expect, it } from 'vitest';

import { selectAddableAgents, toPickableAgents } from './selectAddableAgents';

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

describe('toPickableAgents', () => {
  const item = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      pinned: false,
      title: id,
      type: 'agent',
      updatedAt: new Date(updatedAt),
      ...extra,
    }) as any;

  it('keeps agents only, newest first, and flags builtins as the inbox', () => {
    const picked = toPickableAgents([
      item('old', '2026-01-01'),
      item('group', '2026-05-01', { type: 'group' }),
      item('inbox-agent', '2026-04-01', { slug: 'inbox' }),
      item('new', '2026-03-01'),
      item('old', '2026-01-01'),
    ]);

    expect(picked.map((a) => [a.id, a.isInbox])).toEqual([
      ['inbox-agent', true],
      ['new', false],
      ['old', false],
    ]);
    expect(selectAddableAgents(picked, []).map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('drops a chat-group member avatar list that is not a single image', () => {
    const [picked] = toPickableAgents([item('a', '2026-01-01', { avatar: [{ avatar: 'x' }] })]);

    expect(picked.avatar).toBeNull();
  });
});

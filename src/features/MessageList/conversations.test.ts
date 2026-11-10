import type { ChannelListItem, RecentItem, SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildConversationEntries,
  buildConversationSections,
  formatConversationTime,
  inboxActivity,
  latestActivity,
  latestTopicOf,
} from './conversations';

const agent = (id: string, updatedAt: string, extra: Partial<SidebarAgentItem> = {}) =>
  ({
    id,
    pinned: false,
    title: id,
    type: 'agent',
    updatedAt: new Date(updatedAt),
    ...extra,
  }) as SidebarAgentItem;

const topic = (extra: Partial<RecentItem> & { updatedAt: string }) =>
  ({
    icon: '',
    id: Math.random().toString(),
    routePath: '/',
    status: null,
    title: 'topic',
    type: 'topic',
    ...extra,
    updatedAt: new Date(extra.updatedAt),
  }) as RecentItem;

describe('buildConversationSections', () => {
  it('orders by latest activity, pinned first, with the latest topic as preview', () => {
    const { pinned, recent } = buildConversationSections(
      [
        agent('a', '2026-10-01'),
        agent('b', '2026-10-02'),
        agent('p', '2026-09-01', { pinned: true }),
        agent('g', '2026-09-01', { type: 'group' }),
      ],
      [
        topic({ agentId: 'a', lastAssistantMessage: 'old', updatedAt: '2026-10-03' }),
        topic({ agentId: 'a', lastAssistantMessage: 'newest\n reply', updatedAt: '2026-10-05' }),
        topic({ routePath: '/group/g/tpc_1', title: 'group topic', updatedAt: '2026-10-04' }),
        topic({ agentId: 'b', type: 'document', updatedAt: '2026-10-09' }),
      ],
    );

    expect(pinned.map((c) => c.item.id)).toEqual(['p']);
    expect(recent.map((c) => c.item.id)).toEqual(['a', 'g', 'b']);
    expect(recent[0].preview).toBe('newest reply');
    expect(recent[1].preview).toBe('group topic');
    // Documents are not conversation activity.
    expect(recent[2].activeAt).toEqual(new Date('2026-10-02'));
  });

  it('attributes a group topic that also carries the supervisor agentId to the group', () => {
    const { recent } = buildConversationSections(
      [agent('sup', '2026-09-01'), agent('g', '2026-09-01', { type: 'group' })],
      [
        topic({
          agentId: 'sup',
          lastAssistantMessage: 'group reply',
          routePath: '/group/g/tpc_2',
          updatedAt: '2026-10-05',
        }),
      ],
    );

    expect(recent.map((c) => c.item.id)).toEqual(['g', 'sup']);
    expect(recent[0].preview).toBe('group reply');
    // The supervisor only keeps its own timestamp and never shows the group's reply.
    expect(recent[1].activeAt).toEqual(new Date('2026-09-01'));
    expect(recent[1].preview).toBeUndefined();
  });

  it('drops duplicate ids and falls back to the description', () => {
    const { recent } = buildConversationSections(
      [agent('a', '2026-10-01', { description: 'helps' }), agent('a', '2026-10-01')],
      undefined,
    );

    expect(recent).toHaveLength(1);
    expect(recent[0].preview).toBe('helps');
  });
});

describe('buildConversationSections with direct Channels', () => {
  // The row opened the direct Channel but still showed the legacy topic's badge, preview and time.
  it('describes an agent row by the direct Channel it opens', () => {
    const direct = {
      agentId: 'a',
      createdAt: new Date('2026-10-01'),
      id: 'chn_a',
      lastMessage: { content: '**Done**, see\n the PR', createdAt: new Date('2026-10-09') },
      unreadCount: 2,
    } as ChannelListItem;
    const { recent } = buildConversationSections(
      [agent('a', '2026-10-01', { unreadCount: 5 }), agent('b', '2026-10-05')],
      [topic({ agentId: 'a', lastAssistantMessage: 'legacy reply', updatedAt: '2026-10-02' })],
      new Map([['a', direct]]),
    );

    expect(recent.map((c) => c.item.id)).toEqual(['a', 'b']);
    expect(recent[0]).toMatchObject({
      activeAt: new Date('2026-10-09'),
      preview: 'Done, see the PR',
      unread: 2,
    });
  });

  it('falls back to the agent description while its direct Channel is empty', () => {
    const direct = {
      agentId: 'a',
      createdAt: new Date('2026-10-01'),
      id: 'chn_a',
      lastMessage: null,
      unreadCount: 0,
    } as ChannelListItem;
    const { recent } = buildConversationSections(
      [agent('a', '2026-10-01', { description: 'Cooks dinner' })],
      [topic({ agentId: 'a', lastAssistantMessage: 'legacy reply', updatedAt: '2026-10-02' })],
      new Map([['a', direct]]),
    );

    expect(recent[0]).toMatchObject({ preview: 'Cooks dinner', unread: 0 });
  });
});

describe('formatConversationTime', () => {
  const now = new Date(2026, 9, 26, 15, 0);

  it.each([
    [new Date(2026, 9, 26, 9, 5), '09:05'],
    [new Date(2026, 9, 25, 23, 59), '10/25'],
    [new Date(2025, 0, 2), '2025/1/2'],
  ])('formats %s as %s', (date, expected) => {
    expect(formatConversationTime(date, now)).toBe(expected);
  });
});

describe('buildConversationEntries', () => {
  const sections = buildConversationSections(
    [
      agent('a', '2026-10-05', { title: 'Alpha' }),
      agent('b', '2026-10-01', { title: 'Beta' }),
      agent('p', '2026-09-01', { pinned: true, title: 'Pinned' }),
    ],
    undefined,
  );
  const ids = (entries: ReturnType<typeof buildConversationEntries>) =>
    entries.map((e) =>
      e.type === 'inbox' ? 'inbox' : e.type === 'channel' ? e.channel.id : e.item.id,
    );
  const channel = (id: string, title: string, updatedAt: string) =>
    ({
      createdAt: new Date('2026-01-01'),
      id,
      title,
      updatedAt: new Date(updatedAt),
    }) as ChannelListItem;

  it('places Lobe AI by its own activity instead of pinning it on top', () => {
    expect(
      ids(
        buildConversationEntries(sections, { activeAt: new Date('2026-10-03'), title: 'Lobe AI' }),
      ),
    ).toEqual(['p', 'a', 'inbox', 'b']);
  });

  it('puts Lobe AI last until its activity is known', () => {
    expect(ids(buildConversationEntries(sections, { title: 'Lobe AI' }))).toEqual([
      'p',
      'a',
      'b',
      'inbox',
    ]);
  });

  it('filters every row, Lobe AI included, by title', () => {
    expect(ids(buildConversationEntries(sections, { title: 'Lobe AI' }, 'bet'))).toEqual(['b']);
    expect(ids(buildConversationEntries(sections, { title: 'Lobe AI' }, 'lobe'))).toEqual([
      'inbox',
    ]);
  });

  it('matches the personal name shown on the row, not only the role title', () => {
    const named = {
      pinned: [],
      recent: [
        {
          activeAt: new Date('2026-01-01'),
          item: agent('n', '2026-01-01', { name: 'Alice', title: 'Health Assistant' }),
        },
      ],
    };

    expect(ids(buildConversationEntries(named, undefined, 'alice'))).toEqual(['n']);
    expect(ids(buildConversationEntries(named, undefined, 'health'))).toEqual(['n']);
  });

  it('orders group Channels with the other conversations by their latest message', () => {
    const channels = [
      channel('chn_team', 'Team', '2026-10-03'),
      channel('chn_old', 'Archive talk', '2026-08-01'),
    ];

    expect(ids(buildConversationEntries(sections, undefined, '', channels))).toEqual([
      'p',
      'a',
      'chn_team',
      'b',
      'chn_old',
    ]);
    expect(ids(buildConversationEntries(sections, undefined, 'team', channels))).toEqual([
      'chn_team',
    ]);
  });
});

describe('latestTopicOf', () => {
  it("takes one owner's newest topic and leaves other owners alone", () => {
    const recents = [
      topic({ agentId: 'inbox', updatedAt: '2026-10-03' }),
      topic({ agentId: 'inbox', lastAssistantMessage: 'newest', updatedAt: '2026-10-06' }),
      topic({ agentId: 'a', updatedAt: '2026-10-09' }),
    ];

    expect(latestTopicOf(recents, 'inbox')?.lastAssistantMessage).toBe('newest');
    expect(latestTopicOf(recents, 'missing')).toBeUndefined();
    // No owner id (inbox unresolved) must not match every topic.
    expect(latestTopicOf(recents, undefined)).toBeUndefined();
  });
});

describe('inboxActivity', () => {
  const direct = (createdAt: string) =>
    ({ lastMessage: { content: 'hi', createdAt } }) as unknown as ChannelListItem;

  it('follows the direct Channel instead of the legacy topics', () => {
    expect(
      inboxActivity('2026-10-02', topic({ updatedAt: '2026-10-09' }), direct('2026-10-05')),
    ).toEqual(new Date('2026-10-05'));
  });

  it('falls back to the latest topic without a direct Channel', () => {
    expect(inboxActivity('2026-10-02', topic({ updatedAt: '2026-10-09' }))).toEqual(
      new Date('2026-10-09'),
    );
  });
});

describe('latestActivity', () => {
  it('uses the later of the own timestamp and the latest topic', () => {
    expect(latestActivity('2026-10-02', topic({ updatedAt: '2026-10-05' }))).toEqual(
      new Date('2026-10-05'),
    );
    expect(latestActivity('2026-10-07', topic({ updatedAt: '2026-10-05' }))).toEqual(
      new Date('2026-10-07'),
    );
    expect(latestActivity(undefined, undefined)).toBeUndefined();
  });
});

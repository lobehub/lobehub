import { describe, expect, it } from 'vitest';

import {
  type CustomSessionGroup,
  type LobeAgentSession,
  type LobeSessions,
  LobeSessionType,
} from '@/types/session';

import { filterSessionsForView, getRecentChatSessions } from './helpers';

const createSession = (
  id: string,
  updatedAt: string,
  options: { type?: LobeSessionType; virtual?: boolean } = {},
): LobeSessions[0] => {
  if (options.type === LobeSessionType.Group) {
    return {
      createdAt: new Date(updatedAt),
      id,
      meta: {},
      type: LobeSessionType.Group,
      updatedAt: new Date(updatedAt),
    };
  }

  return {
    config: {
      chatConfig: {},
      model: 'gpt-4',
      params: {},
      systemRole: '',
      virtual: options.virtual,
    } as LobeAgentSession['config'],
    createdAt: new Date(updatedAt),
    id,
    meta: {},
    model: 'gpt-4',
    type: LobeSessionType.Agent,
    updatedAt: new Date(updatedAt),
  };
};

describe('SessionListContent helpers', () => {
  it('keeps the newest duplicate, sorts by updatedAt descending, and applies the mobile limit', () => {
    const olderDuplicate = createSession('duplicate', '2026-06-11T00:00:00.000Z');
    const newestDuplicate = createSession('duplicate', '2026-06-20T00:00:00.000Z');
    const customSessionGroups: CustomSessionGroup[] = [
      {
        children: [
          createSession('group-newest', '2026-06-21T00:00:00.000Z'),
          createSession('group-oldest', '2026-06-10T00:00:00.000Z'),
        ],
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        id: 'group-1',
        name: 'Group',
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ];

    const recentSessions = getRecentChatSessions({
      customSessionGroups,
      defaultSessions: [olderDuplicate, createSession('default', '2026-06-19T00:00:00.000Z')],
      isMobile: true,
      limit: 3,
      pinnedSessions: [newestDuplicate, createSession('pinned', '2026-06-18T00:00:00.000Z')],
    });

    expect(recentSessions.map((session) => session.id)).toEqual([
      'group-newest',
      'duplicate',
      'default',
    ]);
    expect(recentSessions.find((session) => session.id === 'duplicate')?.updatedAt).toEqual(
      newestDuplicate.updatedAt,
    );
  });

  it('keeps group chat sessions in the mobile recent list', () => {
    const recentSessions = getRecentChatSessions({
      defaultSessions: [
        createSession('mobile-agent', '2026-06-19T00:00:00.000Z'),
        createSession('mobile-group', '2026-06-21T00:00:00.000Z', {
          type: LobeSessionType.Group,
        }),
      ],
      isMobile: true,
      pinnedSessions: [],
    });

    expect(recentSessions.map((session) => session.id)).toEqual(['mobile-group', 'mobile-agent']);
  });

  it('keeps mobile virtual agents but hides them for non-mobile views like the existing list filter', () => {
    const sessions = [
      createSession('virtual-agent', '2026-06-21T00:00:00.000Z', { virtual: true }),
      createSession('regular-agent', '2026-06-20T00:00:00.000Z'),
    ];

    expect(filterSessionsForView(sessions, true).map((session) => session.id)).toEqual([
      'virtual-agent',
      'regular-agent',
    ]);
    expect(filterSessionsForView(sessions, false).map((session) => session.id)).toEqual([
      'regular-agent',
    ]);
  });
});

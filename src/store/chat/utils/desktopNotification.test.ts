import {
  AGENT_CHAT_TOPIC_URL,
  AGENT_CHAT_URL,
  GROUP_CHAT_TOPIC_URL,
  GROUP_CHAT_URL,
} from '@lobechat/const';
import { describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import {
  buildNotificationBody,
  resolveNotificationNavigate,
  resolveNotificationNavigatePath,
  resolveNotificationTitle,
} from './desktopNotification';
import { topicMapKey } from './topicMapKey';

vi.mock('@/store/agent', () => ({ getAgentStoreState: () => ({}) }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (agentId: string) => () =>
      agentId === 'agent-named' ? { title: 'My Agent' } : undefined,
  },
}));

const FALLBACK = 'fallback';

describe('resolveNotificationNavigatePath', () => {
  it('deep-links a 1:1 agent + topic to the specific topic', () => {
    expect(resolveNotificationNavigatePath({ agentId: 'a1', topicId: 't1' })).toBe(
      AGENT_CHAT_TOPIC_URL('a1', 't1'),
    );
  });

  it('preserves the originating workspace for agent topics', () => {
    expect(
      resolveNotificationNavigatePath({ agentId: 'a1', topicId: 't1', workspaceSlug: 'team' }),
    ).toBe('/team/agent/a1/t1');
  });

  it('falls back to the agent root when there is no topic', () => {
    expect(resolveNotificationNavigatePath({ agentId: 'a1' })).toBe(AGENT_CHAT_URL('a1'));
  });

  it('deep-links a group chat to the specific topic, taking precedence over agent/topic', () => {
    expect(resolveNotificationNavigatePath({ agentId: 'a1', groupId: 'g1', topicId: 't1' })).toBe(
      GROUP_CHAT_TOPIC_URL('g1', 't1'),
    );
  });

  it('preserves the originating workspace for group topics', () => {
    expect(
      resolveNotificationNavigatePath({
        agentId: 'a1',
        groupId: 'g1',
        topicId: 't1',
        workspaceSlug: 'team',
      }),
    ).toBe('/team/group/g1/t1');
  });

  it('falls back to the group root when there is no topic', () => {
    expect(resolveNotificationNavigatePath({ agentId: 'a1', groupId: 'g1' })).toBe(
      GROUP_CHAT_URL('g1'),
    );
  });

  it('returns undefined when there is no routable context', () => {
    expect(resolveNotificationNavigatePath({})).toBeUndefined();
  });

  it('marks notification navigation as escaped so renderer uses the path literally', () => {
    expect(resolveNotificationNavigate({ agentId: 'a1', topicId: 't1' })).toEqual({
      escape: true,
      path: AGENT_CHAT_TOPIC_URL('a1', 't1'),
    });
  });

  it('marks workspace notification navigation as escaped after prefixing the path', () => {
    expect(
      resolveNotificationNavigate({ agentId: 'a1', topicId: 't1', workspaceSlug: 'team' }),
    ).toEqual({
      escape: true,
      path: '/team/agent/a1/t1',
    });
  });
});

describe('resolveNotificationTitle', () => {
  const makeGet =
    (topicDataMap: unknown): (() => ChatStore) =>
    () =>
      ({ topicDataMap }) as unknown as ChatStore;

  it('prefers the topic title', () => {
    const key = topicMapKey({ agentId: 'agent-named' });
    const get = makeGet({ [key]: { items: [{ id: 't1', title: 'My Topic' }] } });
    expect(resolveNotificationTitle(get, { agentId: 'agent-named', topicId: 't1' }, FALLBACK)).toBe(
      'My Topic',
    );
  });

  it('falls back to the agent name when the topic has no title', () => {
    const get = makeGet({});
    expect(resolveNotificationTitle(get, { agentId: 'agent-named', topicId: 't1' }, FALLBACK)).toBe(
      'My Agent',
    );
  });

  it('does not crash when the topic store slice is missing', () => {
    const get = makeGet(undefined);
    expect(resolveNotificationTitle(get, { agentId: 'agent-named', topicId: 't1' }, FALLBACK)).toBe(
      'My Agent',
    );
  });

  it('uses the caller fallback when neither topic nor agent name resolves', () => {
    const get = makeGet({});
    expect(resolveNotificationTitle(get, { agentId: 'unknown-agent' }, FALLBACK)).toBe(FALLBACK);
  });
});

describe('buildNotificationBody', () => {
  it('strips markdown to plain text', () => {
    const body = buildNotificationBody('**Done** with the `task`', FALLBACK);
    expect(body).toContain('Done');
    expect(body).not.toContain('**');
    expect(body).not.toContain('`');
  });

  it('caps an overlong reply and appends an ellipsis', () => {
    const body = buildNotificationBody('a'.repeat(500), FALLBACK);
    expect(body).toHaveLength(257);
    expect(body.endsWith('…')).toBe(true);
  });

  it('returns the fallback for empty / undefined content', () => {
    expect(buildNotificationBody(undefined, FALLBACK)).toBe(FALLBACK);
    expect(buildNotificationBody('   ', FALLBACK)).toBe(FALLBACK);
  });
});

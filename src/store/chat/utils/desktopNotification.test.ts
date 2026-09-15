import type * as Constants from '@lobechat/const';
import {
  AGENT_CHAT_TOPIC_URL,
  AGENT_CHAT_URL,
  GROUP_CHAT_TOPIC_URL,
  GROUP_CHAT_URL,
} from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import {
  buildNotificationBody,
  buildNotificationSender,
  notifyDesktopAgentCompleted,
  resolveNotificationNavigate,
  resolveNotificationNavigatePath,
  resolveNotificationTitle,
} from './desktopNotification';
import { renderAvatarToDataUrl } from './notificationAvatar';
import { topicMapKey } from './topicMapKey';

const { getNotificationSoundFile, playSound, showNotification } = vi.hoisted(() => ({
  getNotificationSoundFile: vi.fn(),
  playSound: vi.fn(),
  showNotification: vi.fn(),
}));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof Constants>()),
  isDesktop: true,
}));
vi.mock('@/services/electron/completionSound', () => ({
  completionSoundService: { getNotificationSoundFile, play: playSound },
}));
vi.mock('@/services/electron/desktopNotification', () => ({
  desktopNotificationService: { showNotification },
}));

vi.mock('@/store/agent', () => ({ getAgentStoreState: () => ({}) }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (agentId: string) => () =>
      agentId === 'agent-named' ? { avatar: '🤖', title: 'My Agent' } : undefined,
  },
}));
vi.mock('./notificationAvatar', () => ({
  renderAvatarToDataUrl: vi.fn(async () => 'data:image/png;base64,MOCK'),
}));

const FALLBACK = 'fallback';

describe('completion sound and desktop banner', () => {
  beforeEach(() => {
    getNotificationSoundFile.mockReset().mockResolvedValue(undefined);
    playSound.mockReset().mockResolvedValue(undefined);
    showNotification.mockReset().mockResolvedValue({ success: true });
  });

  it('leaves a delivered banner to carry the sound alone', async () => {
    await notifyDesktopAgentCompleted(() => ({}) as ChatStore, { context: {}, content: 'Done' });
    expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ body: 'Done' }));
    expect(playSound).not.toHaveBeenCalled();
  });

  it.each([
    ['skipped because the window has focus', { skipped: true, success: true }],
    ['failed to display', { success: false }],
  ])('plays the in-app chime when the banner %s', async (_case, result) => {
    showNotification.mockResolvedValue(result);
    await notifyDesktopAgentCompleted(() => ({}) as ChatStore, { context: {} });
    expect(playSound).toHaveBeenCalledTimes(1);
  });

  it('hands the picked banner sound to the main process', async () => {
    getNotificationSoundFile.mockResolvedValue('lobehub-complete.wav');
    await notifyDesktopAgentCompleted(() => ({}) as ChatStore, { context: {} });
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ soundName: 'lobehub-complete.wav' }),
    );
  });

  it('swallows a failing chime so the notification path still completes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      showNotification.mockResolvedValue({ skipped: true, success: true });
      playSound.mockRejectedValue(new Error('Unavailable audio'));
      await expect(
        notifyDesktopAgentCompleted(() => ({}) as ChatStore, { context: {} }),
      ).resolves.toBeUndefined();
    } finally {
      consoleError.mockRestore();
    }
  });
});

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

describe('buildNotificationSender', () => {
  it('returns undefined without an agent context', async () => {
    expect(await buildNotificationSender({ topicId: 't1' })).toBeUndefined();
  });

  it('returns undefined when the agent has no display name', async () => {
    expect(await buildNotificationSender({ agentId: 'agent-unknown' })).toBeUndefined();
  });

  it('builds the sender from agent meta with a rendered avatar', async () => {
    expect(await buildNotificationSender({ agentId: 'agent-named', topicId: 't1' })).toEqual({
      avatarDataUrl: 'data:image/png;base64,MOCK',
      conversationId: 'agent-named:t1',
      name: 'My Agent',
    });
  });

  it('scopes the conversation to the group when present', async () => {
    const sender = await buildNotificationSender({
      agentId: 'agent-named',
      groupId: 'g1',
      topicId: 't1',
    });

    expect(sender?.conversationId).toBe('g1:t1');
  });

  it('keeps the sender when avatar rendering fails', async () => {
    vi.mocked(renderAvatarToDataUrl).mockRejectedValueOnce(new Error('render failed'));

    expect(await buildNotificationSender({ agentId: 'agent-named' })).toEqual({
      avatarDataUrl: undefined,
      conversationId: 'agent-named',
      name: 'My Agent',
    });
  });
});

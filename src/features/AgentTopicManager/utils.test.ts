import type { ChatTopic } from '@/types/topic';

import {
  buildBotChannelGroups,
  getBotChannelShortLabel,
  getBotPlatformName,
  getProjectFilterLabel,
  getProjectLabel,
  matchesBotChannel,
  matchesGroup,
} from './utils';

const createTopic = (metadata: ChatTopic['metadata']): ChatTopic => ({
  createdAt: 1,
  id: 'topic-1',
  metadata,
  title: 'Topic',
  updatedAt: 1,
});

describe('AgentTopicManager utils', () => {
  it('matches project filters by source path while displaying active worktree context', () => {
    const topic = createTopic({
      workingDirectory: '/repo-fix',
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
        path: '/repo',
        repoType: 'git',
      },
    });

    expect(matchesGroup(topic, ['/repo'])).toBe(true);
    expect(matchesGroup(topic, ['/repo-fix'])).toBe(false);
    expect(getProjectFilterLabel(topic)).toBe('repo');
    expect(getProjectLabel(topic)).toBe('repo/repo-fix · fix');
  });

  it('matches bot channel filters by metadata.bot.platformThreadId', () => {
    const topic = createTopic({
      bot: {
        applicationId: 'app-1',
        isOwner: true,
        platform: 'discord',
        platformThreadId: 'discord:guild:channel:thread',
        senderExternalUserId: 'user-1',
      },
    });

    expect(matchesBotChannel(topic, [])).toBe(true);
    expect(matchesBotChannel(topic, ['discord:guild:channel:thread'])).toBe(true);
    expect(matchesBotChannel(topic, ['telegram:chat-456'])).toBe(false);
  });

  it('never matches a bot channel filter when the topic has no bot metadata', () => {
    const topic = createTopic({});
    expect(matchesBotChannel(topic, ['discord:guild:channel'])).toBe(false);
  });

  it('builds bot → channel groups from topics, deduped and labeled', () => {
    const discordTopic = createTopic({
      bot: {
        applicationId: 'app-1',
        isOwner: true,
        platform: 'discord',
        platformThreadId: 'discord:guild:channel-a',
        senderExternalUserId: 'user-1',
      },
    });
    const duplicateChannelTopic = createTopic({
      bot: {
        applicationId: 'app-1',
        isOwner: true,
        platform: 'discord',
        platformThreadId: 'discord:guild:channel-a',
        senderExternalUserId: 'user-2',
      },
    });
    const secondDiscordChannel = createTopic({
      bot: {
        applicationId: 'app-1',
        isOwner: false,
        platform: 'discord',
        platformThreadId: 'discord:guild:channel-b',
        senderExternalUserId: 'user-3',
      },
    });
    const telegramTopic = createTopic({
      bot: {
        applicationId: 'tg-app',
        isOwner: true,
        platform: 'telegram',
        platformThreadId: 'telegram:chat-456',
        senderExternalUserId: 'user-4',
      },
    });
    const plainTopic = createTopic({});

    const groups = buildBotChannelGroups([
      plainTopic,
      discordTopic,
      duplicateChannelTopic,
      secondDiscordChannel,
      telegramTopic,
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: 'discord:app-1',
      label: 'Discord',
      platform: 'discord',
    });
    expect(groups[0].channels.map((c) => c.key)).toEqual([
      'discord:guild:channel-a',
      'discord:guild:channel-b',
    ]);
    expect(groups[1]).toMatchObject({ key: 'telegram:tg-app', label: 'Telegram' });
    expect(groups[1].channels[0].label).toBe('chat-456');
  });

  it('exposes human-readable platform names and short channel labels', () => {
    expect(getBotPlatformName('discord')).toBe('Discord');
    expect(getBotPlatformName('feishu')).toBe('Feishu');
    expect(getBotPlatformName('unknown-platform')).toBe('unknown-platform');
    expect(getBotChannelShortLabel('discord:guild:channel:thread')).toBe('thread');
    expect(getBotChannelShortLabel('telegram:chat-456')).toBe('chat-456');
    expect(getBotChannelShortLabel('thread-1')).toBe('thread-1');
  });
});

import type { ChatTopic } from '@/types/topic';

import {
  buildBotChannelOptions,
  getBotPlatformName,
  getProjectFilterLabel,
  getProjectLabel,
  matchesBotChannel,
  matchesGroup,
  matchesTrigger,
} from './utils';

const createTopic = (
  metadata: ChatTopic['metadata'],
  overrides: Partial<ChatTopic> = {},
): ChatTopic => ({
  createdAt: 1,
  id: 'topic-1',
  metadata,
  title: 'Topic',
  updatedAt: 1,
  ...overrides,
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

  it('matches bot channel filters by metadata.bot.platform', () => {
    const topic = createTopic(
      {
        bot: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild:channel:thread',
          senderExternalUserId: 'user-1',
        },
      },
      { trigger: 'bot' },
    );

    expect(matchesBotChannel(topic, [])).toBe(true);
    expect(matchesBotChannel(topic, ['discord'])).toBe(true);
    expect(matchesBotChannel(topic, ['telegram'])).toBe(false);
    expect(matchesTrigger(topic, ['bot'])).toBe(true);
  });

  it('never matches a bot channel filter when the topic has no bot metadata', () => {
    const topic = createTopic({});
    expect(matchesBotChannel(topic, ['discord'])).toBe(false);
  });

  it('builds flattened platform options from topics, deduped and labeled', () => {
    const discordA = createTopic({
      bot: {
        applicationId: 'app-1',
        isOwner: true,
        platform: 'discord',
        platformThreadId: 'discord:guild:channel-a',
        senderExternalUserId: 'user-1',
      },
    });
    const discordB = createTopic({
      bot: {
        applicationId: 'app-1',
        isOwner: false,
        platform: 'discord',
        platformThreadId: 'discord:guild:channel-b',
        senderExternalUserId: 'user-2',
      },
    });
    const telegram = createTopic({
      bot: {
        applicationId: 'tg-app',
        isOwner: true,
        platform: 'telegram',
        platformThreadId: 'telegram:chat-456',
        senderExternalUserId: 'user-3',
      },
    });
    const plainTopic = createTopic({});

    const options = buildBotChannelOptions([plainTopic, discordA, discordB, telegram]);

    // Flattened to the platform level only — two discord topics collapse to one entry.
    expect(options).toEqual([
      { key: 'discord', label: 'Discord' },
      { key: 'telegram', label: 'Telegram' },
    ]);
  });

  it('exposes human-readable platform names', () => {
    expect(getBotPlatformName('discord')).toBe('Discord');
    expect(getBotPlatformName('feishu')).toBe('Feishu');
    expect(getBotPlatformName('unknown-platform')).toBe('unknown-platform');
  });
});

import type { ChannelListItem, ShareVisitorConversation } from '@lobechat/types';

import type { ChatTopic } from '@/types/topic';

import {
  agentGroupChannels,
  areAllTopicsArchived,
  buildBotChannelOptions,
  channelListState,
  getBotPlatformName,
  getProjectFilterLabel,
  getProjectInfo,
  getProjectLabel,
  matchesBotChannel,
  matchesChannelSearch,
  matchesChannelStatus,
  matchesGroup,
  matchesShareVisitorSearch,
  matchesShareVisitorStatus,
  matchesTrigger,
  sortChannelsBy,
  sortShareVisitorsBy,
} from './utils';

const createChannel = (overrides: Partial<ChannelListItem> = {}): ChannelListItem => ({
  agentId: null,
  agentIds: [],
  canDelete: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  id: 'chn_1',
  projectId: null,
  sequence: 1,
  status: 'active',
  title: 'Channel',
  workspaceId: null,
  ...overrides,
});

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
  describe('channelListState', () => {
    it('stays idle while the Channel source is not selected', () => {
      expect(channelListState(false, undefined, new Error('x'))).toEqual({
        error: undefined,
        loading: false,
      });
    });

    it('loads until the first list arrives', () => {
      expect(channelListState(true, undefined, undefined)).toEqual({
        error: undefined,
        loading: true,
      });
    });

    it('reports a failed first fetch instead of loading forever', () => {
      const error = new Error('network');
      expect(channelListState(true, undefined, error)).toEqual({ error, loading: false });
    });

    it('keeps showing a loaded list when a refresh fails', () => {
      expect(channelListState(true, [], new Error('network'))).toEqual({
        error: undefined,
        loading: false,
      });
    });
  });

  it('offers unarchive only when every selected topic is archived', () => {
    const topics = [
      createTopic(undefined, { id: 'a', status: 'completed' }),
      createTopic(undefined, { id: 'b', status: 'archived' }),
      createTopic(undefined, { id: 'c', status: 'active' }),
    ];

    expect(areAllTopicsArchived(topics, ['a', 'b'])).toBe(true);
    expect(areAllTopicsArchived(topics, ['a', 'c'])).toBe(false);
    expect(areAllTopicsArchived(topics, ['missing'])).toBe(false);
    expect(areAllTopicsArchived(topics, [])).toBe(false);
  });

  it('keeps channel search results hidden after clearing the trigger filter', () => {
    expect(matchesTrigger(createTopic({}, { trigger: 'channel' }), [])).toBe(false);
    expect(matchesTrigger(createTopic({}, { trigger: 'channel' }), ['chat'])).toBe(false);
    expect(matchesTrigger(createTopic({}, { trigger: 'task' }), [])).toBe(true);
    expect(matchesTrigger(createTopic({}), [])).toBe(true);
  });

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
    expect(getProjectInfo(topic)).toEqual({ branch: 'fix', path: 'repo/repo-fix' });
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
    expect(getBotPlatformName('dingtalk')).toBe('DingTalk');
    expect(getBotPlatformName('unknown-platform')).toBe('unknown-platform');
  });

  // The `channel` trigger lists the Agent's group Channels; its run topics there stay hidden.
  it('lists only group Channels the agent is a member of', () => {
    const member = createChannel({ agentIds: ['agt_a', 'agt_b'], id: 'member' });
    const other = createChannel({ agentIds: ['agt_b'], id: 'other' });
    const direct = createChannel({ agentId: 'agt_a', agentIds: ['agt_a'], id: 'direct' });
    const stale = createChannel({ agentIds: undefined, id: 'stale' });

    expect(agentGroupChannels([member, other, direct, stale], 'agt_a')).toEqual([member]);
    expect(agentGroupChannels(undefined, 'agt_a')).toEqual([]);
  });

  it('maps Channel status onto the topic status tabs', () => {
    const active = createChannel();
    const archived = createChannel({ status: 'archived' });
    const running = createChannel({
      replyJobs: [
        {
          blockedCode: null,
          id: 'job',
          memberId: 'm',
          publicationRevoked: false,
          status: 'running',
          threadId: null,
          writerHeld: true,
        },
      ],
    });

    expect(matchesChannelStatus(active, 'active')).toBe(true);
    expect(matchesChannelStatus(archived, 'active')).toBe(false);
    expect(matchesChannelStatus(archived, 'completed')).toBe(true);
    expect(matchesChannelStatus(active, 'completed')).toBe(false);
    expect(matchesChannelStatus(running, 'running')).toBe(true);
    expect(matchesChannelStatus(active, 'running')).toBe(false);
    expect(matchesChannelStatus(archived, 'all')).toBe(true);
  });

  it('searches Channels by title and sorts them like topics', () => {
    const alpha = createChannel({
      id: 'a',
      title: 'Alpha Launch',
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    });
    const beta = createChannel({
      createdAt: new Date('2026-01-03T00:00:00Z'),
      id: 'b',
      title: 'Beta',
    });

    expect(matchesChannelSearch(alpha, ' launch ')).toBe(true);
    expect(matchesChannelSearch(beta, 'launch')).toBe(false);
    expect(matchesChannelSearch(beta, '')).toBe(true);
    expect(sortChannelsBy([alpha, beta], 'updatedAt').map((c) => c.id)).toEqual(['b', 'a']);
    expect(sortChannelsBy([beta, alpha], 'title').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('counts share visitors as active, finds them by name or message, and sorts them', () => {
    const visit = (id: string, name: string | null, content: string, updatedAt: string) =>
      ({
        createdAt: new Date('2026-01-01T00:00:00Z'),
        id,
        lastMessage: { content },
        totalCost: 0,
        totalTokens: 0,
        updatedAt: new Date(updatedAt),
        visitor: { avatar: null, id: `u_${id}`, name },
      }) as ShareVisitorConversation;
    const ada = visit('a', 'Ada', 'Plan my trip', '2026-01-02T00:00:00Z');
    const bob = visit('b', null, 'Write a poem', '2026-01-03T00:00:00Z');

    expect(['all', 'active'].every((s) => matchesShareVisitorStatus(s as never))).toBe(true);
    expect(
      ['running', 'completed', 'archived'].some((s) => matchesShareVisitorStatus(s as never)),
    ).toBe(false);
    expect(matchesShareVisitorSearch(ada, ' ada ')).toBe(true);
    expect(matchesShareVisitorSearch(bob, 'poem')).toBe(true);
    expect(matchesShareVisitorSearch(bob, 'ada')).toBe(false);
    expect(sortShareVisitorsBy([ada, bob], 'updatedAt').map((c) => c.id)).toEqual(['b', 'a']);
    expect(sortShareVisitorsBy([bob, ada], 'title').map((c) => c.id)).toEqual(['b', 'a']);
  });
});

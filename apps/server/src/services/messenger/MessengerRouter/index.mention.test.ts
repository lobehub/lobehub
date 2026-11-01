// @vitest-environment node
// Load the router while the suite is collected rather than inside the first
// test's timeout: the shared bot loaders in testUtils import it lazily.
import './index';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fakeChannelThread,
  fakeDmThread,
  fakeMessage,
  loadSlackBot,
  loadTelegramBot,
  mockAgentBridgeConstructor,
  mockAgentExistsById,
  mockAgentModelConstructor,
  mockAppendToList,
  mockChatBot,
  mockFindLink,
  mockGetBotFeatureAccessState,
  mockGetList,
  mockHandleMention,
  mockHandleSubscribed,
  mockListUserWorkspaces,
  mockSetIfNotExists,
  mockSlackBinder,
  mockTelegramBinder,
  resetMessengerRouterMocks,
} from './testUtils';

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).agentRuntimeRedisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/gateway', async () => (await import('./testUtils')).gatewayEnvModule());
vi.mock('../installations', async () => (await import('./testUtils')).installationsModule());
vi.mock('../oauth/slackOAuth', async () => (await import('./testUtils')).slackOAuthModule());
vi.mock('@/server/featureFlags', async () => (await import('./testUtils')).featureFlagsModule());
vi.mock('@/config/messenger', async () => (await import('./testUtils')).messengerConfigModule());
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('@/server/services/bot/AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('@/database/models/agent', async () => (await import('./testUtils')).agentModelModule());
vi.mock('@/database/models/messengerAccountLink', async () =>
  (await import('./testUtils')).messengerAccountLinkModule(),
);
vi.mock('@/database/models/workspace', async () =>
  (await import('./testUtils')).workspaceModelModule(),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('@/database/models/workspaceUserSettings', async () =>
  (await import('./testUtils')).workspaceUserSettingsModule(),
);
vi.mock('@/server/services/resourcePermission', async () =>
  (await import('./testUtils')).resourcePermissionModule(),
);
vi.mock('@/server/services/bot/replyTemplate', async () =>
  (await import('./testUtils')).replyTemplateModule(),
);
vi.mock('../platforms/slack/binder', async () => (await import('./testUtils')).slackBinderModule());
vi.mock('../platforms/telegram/binder', async () =>
  (await import('./testUtils')).telegramBinderModule(),
);
vi.mock('../platforms/wechat/binder', async () =>
  (await import('./testUtils')).wechatBinderModule(),
);
vi.mock('../platforms/linq/binder', async () => (await import('./testUtils')).linqBinderModule());
vi.mock('../platforms/linq/webhook', async () => (await import('./testUtils')).linqWebhookModule());

beforeEach(() => {
  resetMessengerRouterMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerRouter channel @mention', () => {
  it('dispatches a linked user mention to the active agent (in-thread reply)', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: 'workspace-1',
    });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    const thread = fakeChannelThread();
    await handler(thread, fakeMessage({ isMention: true, text: '<@U_BOT> summarise' }));

    // Linked → AgentBridgeService.handleMention is invoked with the
    // user-active agent and the channel thread (chat-adapter-slack handles
    // thread_ts on the underlying chat.postMessage). `onNewMention` is a
    // first-touch entry, so dispatch goes through `handleMention` (mirrors
    // BotMessageRouter).
    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(mockAgentBridgeConstructor).toHaveBeenCalledWith(
      expect.anything(),
      'user_alice',
      'workspace-1',
    );
    expect(mockGetBotFeatureAccessState).toHaveBeenCalledWith({
      action: 'runtime',
      platform: 'slack',
      userId: 'user_alice',
      workspaceId: 'workspace-1',
    });
    expect(mockHandleMention.mock.calls[0][2]).toMatchObject({ agentId: 'agt_main' });
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    // We deliberately do NOT subscribe channel threads — see comment in
    // `onNewMention`.
    expect(thread.subscribe).not.toHaveBeenCalled();
    expect(mockSlackBinder.handleUnlinkedMessage).not.toHaveBeenCalled();
    expect(mockSlackBinder.replyEphemeral).not.toHaveBeenCalled();
  });

  it('sends the feature-gate denial ephemerally for a public channel mention', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: null,
    });
    mockGetBotFeatureAccessState.mockResolvedValueOnce({
      allowed: false,
      blockedMessage: 'Upgrade to continue.',
    });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: true }));

    expect(mockGetBotFeatureAccessState).toHaveBeenCalledWith({
      action: 'runtime',
      platform: 'slack',
      userId: 'user_alice',
    });
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockSlackBinder.replyEphemeral).toHaveBeenCalledWith({
      channelId: 'C_GENERAL',
      text: 'Upgrade to continue.',
      threadTs: '1715000000.000100',
      userId: 'U_ALICE',
    });
    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });

  it('sends the feature-gate denial normally in a private conversation', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: null,
    });
    mockGetBotFeatureAccessState.mockResolvedValueOnce({
      allowed: false,
      blockedMessage: 'Upgrade to continue.',
    });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: true }));

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', 'Upgrade to continue.');
    expect(mockSlackBinder.replyEphemeral).not.toHaveBeenCalled();
  });

  it('skips dispatch and prompts /switch when the active workspace is no longer accessible', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: 'workspace-removed',
    });
    // The user is only a member of workspace-1 now — not workspace-removed.
    mockListUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Workspace 1', role: 'owner' },
    ]);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: true, text: '<@U_BOT> hi' }));

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockSlackBinder.replyEphemeral).toHaveBeenCalledTimes(1);
    expect(mockSlackBinder.replyEphemeral.mock.calls[0][0]).toMatchObject({
      channelId: 'C_GENERAL',
      userId: 'U_ALICE',
    });
  });

  it('skips dispatch and prompts /agents when the active agent no longer exists', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_deleted',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: null,
    });
    // The bound agent was deleted (or moved out of the active scope).
    mockAgentExistsById.mockResolvedValue(false);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: true }));

    // Without this guard the run reaches the agent runtime and the user gets a
    // bare "Agent Execution Failed" with no operation id.
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockAgentExistsById).toHaveBeenCalledWith('agt_deleted');
    expect(mockAgentModelConstructor).toHaveBeenCalledWith({}, 'user_alice', undefined);
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith(
      'D_DM',
      expect.stringContaining('/agents'),
    );
  });

  it('answers linked Telegram Guest recovery prompts through the one-shot reply', async () => {
    await loadTelegramBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: null,
      id: 'link_1',
      platformUserId: '123',
      tenantId: '',
      userId: 'user_alice',
      workspaceId: null,
    });
    mockTelegramBinder.isOneShotMessage.mockReturnValue(true);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    const message = fakeMessage({
      author: { isBot: false, userId: '123', userName: 'alice' },
      isMention: true,
      raw: { guest_query_id: 'gq-linked' },
    });
    await handler(
      {
        id: 'telegram:guest:-100123:bot:999:message:55',
        isDM: false,
        post: vi.fn(),
      },
      message,
    );

    expect(mockTelegramBinder.replyToMessage).toHaveBeenCalledWith(
      message,
      expect.stringContaining('No active agent'),
    );
    expect(mockTelegramBinder.sendDmText).not.toHaveBeenCalled();
    expect(mockTelegramBinder.sendAgentPicker).not.toHaveBeenCalled();
  });

  it('scopes the active-agent check to the linked workspace', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: 'workspace-1',
    });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: true }));

    expect(mockAgentModelConstructor).toHaveBeenCalledWith({}, 'user_alice', 'workspace-1');
    expect(mockHandleMention).toHaveBeenCalledTimes(1);
  });

  it('routes an unlinked channel mention through handleUnlinkedMessage with channelMentionThreadId', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: true, text: '<@U_BOT> hi' }));

    // The Slack binder handles the channel-vs-DM branch — the router only
    // signals which surface this came from via channelMentionThreadId.
    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledTimes(1);
    expect(mockSlackBinder.handleUnlinkedMessage.mock.calls[0][0]).toMatchObject({
      authorUserId: 'U_ALICE',
      channelMentionThreadId: 'slack:C_GENERAL:1715000000.000100',
      chatId: 'C_GENERAL',
    });
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
  });

  it('replies ephemerally when a linked user has no active agent in a channel mention', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: null,
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: true }));

    expect(mockSlackBinder.replyEphemeral).toHaveBeenCalledWith({
      channelId: 'C_GENERAL',
      text: expect.stringContaining('No active agent'),
      threadTs: '1715000000.000100',
      userId: 'U_ALICE',
    });
    // Public DM-style nudge is suppressed in channels.
    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });
});

describe('MessengerRouter onSubscribedMessage gating', () => {
  it('passes DM follow-ups straight through to handle()', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: false }));

    // Follow-up message on a subscribed DM → handleSubscribedMessage so the
    // cached topicId is reused. (Falls back to handleMention internally if
    // no topicId is cached, but that's a separate path.)
    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('responds to a non-mention follow-up while the channel thread is still single-human ()', async () => {
    // The original @mentioner already counts as participant #1 (tracked
    // in `onNewMention`); when their next post arrives in
    // `onSubscribedMessage` the thread is still 1-human, so the bot should
    // reply without requiring a re-mention.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    mockGetList.mockResolvedValue(['U_ALICE']); // alice already tracked

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: false, text: 'follow up' }));

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockSetIfNotExists).not.toHaveBeenCalledWith(
      expect.stringContaining('mention-required-announced'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('announces mention-only mode and drops the message when a second human joins ()', async () => {
    // Alice already in the participants list; Bob's first non-mention post
    // pushes count to 2 → bot must announce + skip dispatch.
    await loadSlackBot();
    mockGetList.mockResolvedValue(['U_ALICE']);
    const thread = fakeChannelThread();

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      thread,
      fakeMessage({
        author: { isBot: false, userId: 'U_BOB', userName: 'bob' },
        isMention: false,
        text: 'taking over',
      }),
    );

    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockAppendToList).toHaveBeenCalledWith(
      'messenger:thread-humans:slack:C_GENERAL:1715000000.000100',
      'U_BOB',
      expect.objectContaining({ maxLength: 50 }),
    );
    expect(mockSetIfNotExists).toHaveBeenCalledWith(
      'messenger:thread-mention-required-announced:slack:C_GENERAL:1715000000.000100',
      '1',
      expect.any(Number),
    );
    expect(thread.post).toHaveBeenCalledWith(expect.stringContaining('@mention me'));
  });

  it('does not announce mention-only mode in a Feishu group main chat', async () => {
    // Same skip path as Slack multi-human, but Feishu group mains already
    // require @mention — do not post the English notice.
    await loadSlackBot();
    mockGetList.mockResolvedValue(['U_ALICE']);
    const thread = {
      id: 'feishu:group:oc_citic_sentry',
      isDM: false,
      post: vi.fn(),
      subscribe: vi.fn(),
    };

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      thread,
      fakeMessage({
        author: { isBot: false, userId: 'U_BOB', userName: 'bob' },
        isMention: false,
        text: 'taking over',
      }),
    );

    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
    expect(mockSetIfNotExists).not.toHaveBeenCalledWith(
      expect.stringContaining('mention-required-announced'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('only announces mention-only mode once per channel thread ()', async () => {
    // Second non-mention in a multi-human thread → `setIfNotExists` returns
    // false, the announcement is suppressed.
    await loadSlackBot();
    mockGetList.mockResolvedValue(['U_ALICE', 'U_BOB']);
    mockSetIfNotExists.mockResolvedValueOnce(false);
    const thread = fakeChannelThread();

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      thread,
      fakeMessage({
        author: { isBot: false, userId: 'U_BOB', userName: 'bob' },
        isMention: false,
        text: 'another non-mention',
      }),
    );

    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });

  it('responds to a re-mention in a subscribed channel thread', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      fakeChannelThread(),
      fakeMessage({ isMention: true, text: '<@U_BOT> follow up' }),
    );

    // Subscribed-thread @-mention → handleSubscribedMessage continues the
    // cached topic.
    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('responds to a @mention even after multi-human switch ()', async () => {
    // After the mode switch, a fresh @mention still gets a reply — the
    // gate keys off `isMention || count <= 1`.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    mockGetList.mockResolvedValue(['U_ALICE', 'U_BOB']);

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      fakeChannelThread(),
      fakeMessage({
        author: { isBot: false, userId: 'U_ALICE', userName: 'alice' },
        isMention: true,
        text: '<@U_BOT> please respond',
      }),
    );

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
  });
});

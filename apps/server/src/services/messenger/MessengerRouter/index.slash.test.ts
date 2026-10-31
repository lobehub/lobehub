// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerRouter } from './index';
import {
  fakeChannelThread,
  fakeMessage,
  loadSlackBot,
  loadTelegramBot,
  mockChatBot,
  mockFindLink,
  mockGetAgentConfigById,
  mockGetWorkspaceUserPreference,
  mockIsResourceAuthorOrAdmin,
  mockOpenDM,
  mockSlackBinder,
  mockTelegramBinder,
  resetMessengerRouterMocks,
  slackCreds,
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

describe('MessengerRouter slash command dispatch', () => {
  // `/agents` reads the user's agents from the live database via
  // `fetchUserAgents` — stub that on the prototype so we don't have to
  // stand up drizzle / the agent table. Other slash tests in this block
  // simply ignore the spy.
  beforeEach(() => {
    vi.spyOn(MessengerRouter.prototype as any, 'fetchUserAgents').mockResolvedValue([
      { id: 'agt_a', isPrivate: false, title: 'A' },
      { id: 'agt_b', isPrivate: false, title: 'B' },
    ]);
  });

  const fakeSlashEvent = (overrides: Partial<any> = {}): any => ({
    channel: { id: 'slack:C_GENERAL', isDM: false },
    command: '/agents',
    text: '',
    user: { userId: 'U_ALICE', userName: 'alice' },
    ...overrides,
  });

  const fakeTelegramSlashEvent = (overrides: Partial<any> = {}): any => ({
    channel: { id: 'telegram:123', isDM: false, post: vi.fn() },
    command: '/start',
    text: '',
    user: { userId: '123', userName: 'alice' },
    ...overrides,
  });

  it('registers Telegram slash commands and routes private /start to the link flow', async () => {
    await loadTelegramBot();
    mockFindLink.mockResolvedValue(null);

    const [paths, handler] = mockChatBot.onSlashCommand.mock.calls[0] as [
      string[],
      (event: any) => Promise<void>,
    ];
    expect(paths).toContain('/start');

    await handler(fakeTelegramSlashEvent());

    expect(mockTelegramBinder.handleUnlinkedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUserId: '123',
        chatId: '123',
        channelMentionThreadId: undefined,
      }),
    );
    expect(mockTelegramBinder.sendDmText).not.toHaveBeenCalled();
  });

  it('keeps an unlinked Telegram group /start visible without leaking a link token', async () => {
    await loadTelegramBot();
    mockFindLink.mockResolvedValue(null);
    const post = vi.fn();

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(
      fakeTelegramSlashEvent({ channel: { id: 'telegram:-100123:42', isDM: false, post } }),
    );

    expect(post).toHaveBeenCalledWith(expect.stringContaining('send `/start` there'));
    expect(mockTelegramBinder.handleUnlinkedMessage).not.toHaveBeenCalled();
    expect(mockTelegramBinder.sendDmText).not.toHaveBeenCalled();
    expect(mockOpenDM).not.toHaveBeenCalled();
  });

  it('routes a linked Telegram group /agents picker to the invoker DM', async () => {
    await loadTelegramBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_a',
      id: 'link_1',
      platformUserId: '123',
      tenantId: '',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(
      fakeTelegramSlashEvent({
        channel: { id: 'telegram:-100123', isDM: false, post: vi.fn() },
        command: '/agents',
      }),
    );

    expect(mockTelegramBinder.sendAgentPicker).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        ephemeralTo: '123',
        text: expect.stringContaining('Tap an agent'),
      }),
    );
    expect(mockTelegramBinder.sendDmText).not.toHaveBeenCalled();
  });

  it('renders the picker as ephemeral when /agents is invoked from a public channel', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_a',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    // `onSlashCommand(paths, handler)` — second arg is the handler.
    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent());

    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith('C_GENERAL', {
      entries: expect.any(Array),
      ephemeralTo: 'U_ALICE',
      text: expect.stringContaining('Tap an agent'),
    });
  });

  it('resolves the DM thread for /new slash and clears topicId (slash from DM)', async () => {
    // chat-sdk's slash-event ChannelImpl never carries `isDM=true` (see
    // handleSlashCommand for the workaround). The DM here is detected
    // via the Slack channel-id prefix (`D...`).
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = { id: 'slack:D_DM:', isDM: true, setState: vi.fn() };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(
      fakeSlashEvent({
        // `isDM: false` mirrors what chat-sdk actually delivers — we
        // detect DM via the channel-id prefix instead.
        channel: { id: 'slack:D_DM', isDM: false },
        command: '/new',
      }),
    );

    expect(mockOpenDM).toHaveBeenCalledWith('U_ALICE');
    expect(dmThread.setState).toHaveBeenCalledWith({ topicId: undefined }, { replace: true });
    expect(mockSlackBinder.replyPrivately).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Started a new conversation'),
    );
  });

  it('still resolves the DM thread for /new slash fired from a public channel (clears DM topicId)', async () => {
    // Slash from a public channel can't carry a specific thread anchor,
    // so the most useful behavior is to clear the user's canonical bot
    // conversation (the DM) instead of dropping the request. The
    // confirmation is ephemeral so the channel doesn't see it.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = { id: 'slack:D_DM:', isDM: true, setState: vi.fn() };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ command: '/new' })); // default: channel = C_GENERAL

    expect(mockOpenDM).toHaveBeenCalledWith('U_ALICE');
    expect(dmThread.setState).toHaveBeenCalledWith({ topicId: undefined }, { replace: true });
  });

  it('/mode chat writes the DM thread state and confirms', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = {
      id: 'slack:D_DM:',
      isDM: true,
      setState: vi.fn(),
      state: Promise.resolve(null),
    };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(
      fakeSlashEvent({
        channel: { id: 'slack:D_DM', isDM: false },
        command: '/mode',
        text: 'chat',
      }),
    );

    // Merge write (NOT replace) — switching mode must not clobber topicId.
    expect(dmThread.setState).toHaveBeenCalledWith({ toolMode: 'chat' });
    expect(mockSlackBinder.replyPrivately).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Chat Mode'),
    );
  });

  it('/mode without args renders the tap picker with the current mode marked', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = {
      id: 'slack:D_DM:',
      isDM: true,
      setState: vi.fn(),
      state: Promise.resolve({ toolMode: 'agent', topicId: 'topic-1' }),
    };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: false }, command: '/mode' }));

    expect(dmThread.setState).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith(
      'D_DM',
      expect.objectContaining({
        action: 'mode',
        entries: [
          { id: 'agent', isActive: true, title: 'Agent Mode' },
          { id: 'chat', isActive: false, title: 'Chat Mode' },
        ],
      }),
    );
  });

  it('/mode without args marks the agent-config default when no override is set', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    // Active agent configured as chat-mode (enableAgentMode=false) — the
    // picker must mark Chat Mode even though the thread has no override yet.
    mockGetAgentConfigById.mockResolvedValue({ chatConfig: { enableAgentMode: false } });
    const dmThread = {
      id: 'slack:D_DM:',
      isDM: true,
      setState: vi.fn(),
      state: Promise.resolve(null),
    };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: false }, command: '/mode' }));

    expect(mockGetAgentConfigById).toHaveBeenCalledWith('agt_main');
    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith(
      'D_DM',
      expect.objectContaining({
        action: 'mode',
        entries: [
          { id: 'agent', isActive: false, title: 'Agent Mode' },
          { id: 'chat', isActive: true, title: 'Chat Mode' },
        ],
      }),
    );
  });

  it('/mode without args applies the workspace member-mode override for non-managers', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: 'workspace-1',
    });
    // Shared workspace agent defaults to Agent Mode, but this member turned it
    // off via their per-user override — the picker must mark Chat Mode, the
    // mode execAgent will actually run for them.
    mockGetAgentConfigById.mockResolvedValue({
      chatConfig: { enableAgentMode: true },
      userId: 'user_owner',
      visibility: 'public',
      workspaceId: 'workspace-1',
    });
    mockGetWorkspaceUserPreference.mockResolvedValue({
      agentModeOverrides: { agt_main: false },
    });
    mockIsResourceAuthorOrAdmin.mockResolvedValue(false);
    const dmThread = {
      id: 'slack:D_DM:',
      isDM: true,
      setState: vi.fn(),
      state: Promise.resolve(null),
    };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: false }, command: '/mode' }));

    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith(
      'D_DM',
      expect.objectContaining({
        action: 'mode',
        entries: [
          { id: 'agent', isActive: false, title: 'Agent Mode' },
          { id: 'chat', isActive: true, title: 'Chat Mode' },
        ],
      }),
    );
  });

  it('/mode without args ignores a manager-stale member override (shared config wins)', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
      workspaceId: 'workspace-1',
    });
    // The caller manages this agent — execAgent ignores their own stale
    // override, so the picker must too.
    mockGetAgentConfigById.mockResolvedValue({
      chatConfig: { enableAgentMode: true },
      userId: 'user_owner',
      visibility: 'public',
      workspaceId: 'workspace-1',
    });
    mockGetWorkspaceUserPreference.mockResolvedValue({
      agentModeOverrides: { agt_main: false },
    });
    mockIsResourceAuthorOrAdmin.mockResolvedValue(true);
    const dmThread = {
      id: 'slack:D_DM:',
      isDM: true,
      setState: vi.fn(),
      state: Promise.resolve(null),
    };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: false }, command: '/mode' }));

    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith(
      'D_DM',
      expect.objectContaining({
        action: 'mode',
        entries: [
          { id: 'agent', isActive: true, title: 'Agent Mode' },
          { id: 'chat', isActive: false, title: 'Chat Mode' },
        ],
      }),
    );
  });

  it('/mode from a channel text mention replies text status instead of the picker', async () => {
    // A channel text mention resolves the CHANNEL thread, but picker taps
    // write the canonical DM (handleModeCallback → openDM) — the channel's
    // next run would still read its own state. So no picker here: text
    // status via the ephemeral reply instead.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    mockGetAgentConfigById.mockResolvedValue({ chatConfig: { enableAgentMode: true } });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    const channelThread = { ...fakeChannelThread(), state: Promise.resolve(null) };
    await handler(channelThread, fakeMessage({ isMention: true, text: '/mode' }));

    expect(mockSlackBinder.sendAgentPicker).not.toHaveBeenCalled();
    expect(mockSlackBinder.replyEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'C_GENERAL',
        text: expect.stringContaining('Current mode'),
        userId: 'U_ALICE',
      }),
    );
  });

  it('mode picker tap writes toolMode to the DM thread and re-renders the picker', async () => {
    const router = new MessengerRouter();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = { id: 'slack:D_DM:', isDM: true, setState: vi.fn() };
    const chatBot = { openDM: vi.fn().mockResolvedValue(dmThread) };
    const acknowledgeCallback = vi.fn();
    const binder = { ...mockSlackBinder, acknowledgeCallback };

    await (router as any).handleCallbackAction(
      binder,
      slackCreds('T_ACME'),
      { chatId: 'D_DM', data: 'messenger:mode:chat', fromUserId: 'U_ALICE', messageId: '1' },
      chatBot,
    );

    expect(chatBot.openDM).toHaveBeenCalledWith('U_ALICE');
    expect(dmThread.setState).toHaveBeenCalledWith({ toolMode: 'chat' });
    expect(acknowledgeCallback).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'messenger:mode:chat' }),
      expect.objectContaining({
        toast: expect.stringContaining('Chat Mode'),
        updatedPicker: expect.objectContaining({
          action: 'mode',
          entries: [
            { id: 'agent', isActive: false, title: 'Agent Mode' },
            { id: 'chat', isActive: true, title: 'Chat Mode' },
          ],
        }),
      }),
    );
  });

  it('mode picker tap from an unlinked user acks with the not-linked toast', async () => {
    const router = new MessengerRouter();
    mockFindLink.mockResolvedValue(null);
    const chatBot = { openDM: vi.fn() };
    const acknowledgeCallback = vi.fn();
    const binder = { ...mockSlackBinder, acknowledgeCallback };

    await (router as any).handleCallbackAction(
      binder,
      slackCreds('T_ACME'),
      { chatId: 'D_DM', data: 'messenger:mode:agent', fromUserId: 'U_NOBODY', messageId: '1' },
      chatBot,
    );

    expect(chatBot.openDM).not.toHaveBeenCalled();
    expect(acknowledgeCallback).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toast: expect.stringContaining('/start') }),
    );
  });

  it('/mode from an unlinked user asks them to /start first', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ command: '/mode', text: 'chat' }));

    expect(mockSlackBinder.replyPrivately).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('/start'),
    );
  });

  it('/new slash preserves the /mode choice while clearing topicId', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = {
      id: 'slack:D_DM:',
      isDM: true,
      setState: vi.fn(),
      state: Promise.resolve({ toolMode: 'chat', topicId: 'topic-1' }),
    };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: false }, command: '/new' }));

    expect(dmThread.setState).toHaveBeenCalledWith(
      { toolMode: 'chat', topicId: undefined },
      { replace: true },
    );
  });

  it('renders the picker as a regular DM message when /agents is invoked from a DM', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_a',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: true } }));

    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith('D_DM', {
      entries: expect.any(Array),
      // No ephemeralTo — DMs are private already, picker stays in history.
      ephemeralTo: undefined,
      text: expect.stringContaining('Tap an agent'),
    });
  });

  it('routes /start in a Slack channel through the ephemeral inline link path', async () => {
    // Slack supports `chat.postEphemeral`, so the verify-im link should stay
    // in the channel (invoker-only) instead of bouncing the user out to DM.
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ command: '/start' }));

    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledTimes(1);
    const ctx = mockSlackBinder.handleUnlinkedMessage.mock.calls[0][0];
    expect(ctx).toMatchObject({
      authorUserId: 'U_ALICE',
      chatId: 'C_GENERAL',
      channelMentionThreadId: 'slack:C_GENERAL:',
    });
    // No "check your DM" nudge — the link is already inline in the channel.
    expect(mockSlackBinder.replyPrivately).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Check your DM'),
    );
  });

  it('routes /start in a Slack DM through the regular DM link path', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(
      fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: false }, command: '/start' }),
    );

    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledTimes(1);
    const ctx = mockSlackBinder.handleUnlinkedMessage.mock.calls[0][0];
    expect(ctx).toMatchObject({
      authorUserId: 'U_ALICE',
      chatId: 'D_DM',
      channelMentionThreadId: undefined,
    });
  });
});

// @vitest-environment node
import { Chat } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerRouter } from './index';
import {
  fakeChannelThread,
  fakeDmThread,
  fakeMessage,
  fakeWechatDmThread,
  loadSlackBot,
  loadTelegramBot,
  loadWechatBot,
  mockAppendToList,
  mockChatBot,
  mockFindLink,
  mockGetList,
  mockGetServerFeatureFlagsStateFromRuntimeConfig,
  mockHandleMention,
  mockHandleSubscribed,
  mockListMessengerBindableAgents,
  mockListUserWorkspaces,
  mockSetActiveAgentById,
  mockSetActiveScope,
  mockSlackBinder,
  mockTelegramBinder,
  mockWechatBinder,
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

describe('MessengerRouter WeChat system commands', () => {
  const personalLink = {
    activeAgentId: 'agt_main',
    id: 'link_wechat',
    platformUserId: 'wechat-user',
    tenantId: 'wechat-user',
    userId: 'user_alice',
    workspaceId: null,
  };

  it('always renders /switch instructions in Chinese', async () => {
    await loadWechatBot();
    mockFindLink.mockResolvedValue(personalLink);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeWechatDmThread(), fakeMessage({ isMention: true, text: '/switch' }));

    expect(mockWechatBinder.sendDmText).toHaveBeenCalledWith(
      'wechat-user',
      expect.stringMatching(/可切换空间：[\s\S]*个人账号 \(当前\)[\s\S]*\/switch <序号>/),
    );
  });

  it('omits /start from WeChat help', async () => {
    await loadWechatBot();
    mockFindLink.mockResolvedValue(personalLink);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeWechatDmThread(), fakeMessage({ isMention: true, text: '/help' }));

    const helpText = mockWechatBinder.sendDmText.mock.calls[0][1];
    expect(helpText).toContain('可用命令：');
    expect(helpText).not.toContain('/start');
  });

  it('does not intercept /start as a WeChat system command', async () => {
    await loadWechatBot();
    mockFindLink.mockResolvedValue(personalLink);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeWechatDmThread(), fakeMessage({ isMention: true, text: '/start' }));

    expect(mockWechatBinder.sendDmText).not.toHaveBeenCalled();
    expect(mockHandleMention).toHaveBeenCalledTimes(1);
  });
});

describe('MessengerRouter /agents private vs workspace grouping', () => {
  const workspaceLink = {
    activeAgentId: 'agt_shared',
    id: 'link_wechat',
    platformUserId: 'wechat-user',
    tenantId: 'wechat-user',
    userId: 'user_alice',
    workspaceId: 'workspace-1',
  };

  it('splits the text list into workspace/private sections with continuous numbering', async () => {
    vi.spyOn(MessengerRouter.prototype as any, 'fetchUserAgents').mockResolvedValue([
      { id: 'agt_shared', isPrivate: false, title: 'Lobo' },
      { id: 'agt_shared2', isPrivate: false, title: 'LobeBuilder' },
      { id: 'agt_private', isPrivate: true, title: '私人助理' },
    ]);
    await loadWechatBot();
    mockFindLink.mockResolvedValue(workspaceLink);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeWechatDmThread(), fakeMessage({ isMention: true, text: '/agents' }));

    const text = mockWechatBinder.sendDmText.mock.calls[0][1];
    expect(text).toMatch(
      /工作区 Agent：\n1\. Lobo \(当前\)\n2\. LobeBuilder\n\n私人 Agent：\n3\. 私人助理/,
    );
    expect(text).not.toContain('你的 Agent：');
  });

  it('keeps the flat heading when the list has no private agents', async () => {
    vi.spyOn(MessengerRouter.prototype as any, 'fetchUserAgents').mockResolvedValue([
      { id: 'agt_shared', isPrivate: false, title: 'Lobo' },
    ]);
    await loadWechatBot();
    mockFindLink.mockResolvedValue(workspaceLink);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeWechatDmThread(), fakeMessage({ isMention: true, text: '/agents' }));

    const text = mockWechatBinder.sendDmText.mock.calls[0][1];
    expect(text).toContain('你的 Agent：');
    expect(text).not.toContain('工作区 Agent：');
    expect(text).not.toContain('私人 Agent：');
  });

  it('suffixes private agents on picker entries when the list mixes both groups', async () => {
    vi.spyOn(MessengerRouter.prototype as any, 'fetchUserAgents').mockResolvedValue([
      { id: 'agt_shared', isPrivate: false, title: 'Shared' },
      { id: 'agt_private', isPrivate: true, title: 'Mine' },
    ]);
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_shared',
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
    await handler(fakeDmThread(), fakeMessage({ isMention: true, text: '/agents' }));

    const params = mockSlackBinder.sendAgentPicker.mock.calls[0][1];
    expect(params.entries).toEqual([
      { id: 'agt_shared', isActive: true, title: 'Shared' },
      { id: 'agt_private', isActive: false, title: 'Mine (private)' },
    ]);
  });

  it('partitions workspace agents ahead of private ones in fetchUserAgents', async () => {
    // Earlier tests spy fetchUserAgents on the prototype; undo that so this
    // test exercises the real implementation.
    const maybeSpy = (MessengerRouter.prototype as any).fetchUserAgents;
    if (vi.isMockFunction(maybeSpy)) maybeSpy.mockRestore();

    mockListMessengerBindableAgents.mockResolvedValue([
      {
        avatar: null,
        backgroundColor: null,
        id: 'p1',
        isInbox: false,
        isPrivate: true,
        title: 'P1',
      },
      {
        avatar: null,
        backgroundColor: null,
        id: 'w1',
        isInbox: false,
        isPrivate: false,
        title: 'W1',
      },
      {
        avatar: null,
        backgroundColor: null,
        id: 'p2',
        isInbox: false,
        isPrivate: true,
        title: 'P2',
      },
      {
        avatar: null,
        backgroundColor: null,
        id: 'w2',
        isInbox: false,
        isPrivate: false,
        title: 'W2',
      },
    ]);

    const router = new MessengerRouter();
    const result = await (router as any).fetchUserAgents({} as any, 'user_alice', 'workspace-1');

    // Stable partition: relative order inside each group is preserved.
    expect(result.map((r: any) => r.id)).toEqual(['w1', 'w2', 'p1', 'p2']);
  });
});

describe('MessengerRouter /switch', () => {
  const personalLink = {
    activeAgentId: 'agt_main',
    id: 'link_1',
    platformUserId: 'U_ALICE',
    tenantId: '',
    userId: 'user_alice',
    workspaceId: null,
  };

  it('renders the scope picker with the current scope marked', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(personalLink);
    mockListUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Workspace 1', role: 'owner' },
    ]);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: true, text: '/switch' }));

    // Picker-capable binder → buttons, not a numbered text list, and no switch
    // happens just from listing.
    expect(mockSetActiveScope).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledTimes(1);
    const params = mockSlackBinder.sendAgentPicker.mock.calls[0][1];
    expect(params.action).toBe('scope');
    expect(params.text).toContain('Tap a scope');
    // Personal (the active scope) carries the marker; workspaces follow.
    expect(params.entries).toEqual([
      { id: 'personal', isActive: true, title: 'Personal' },
      { id: 'workspace-1', isActive: false, title: 'Workspace 1' },
    ]);
  });

  it('hides workspace scopes from /switch when workspace feature is disabled', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(personalLink);
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockListUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Workspace 1', role: 'owner' },
    ]);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: true, text: '/switch' }));

    expect(mockSetActiveScope).not.toHaveBeenCalled();
    expect(mockListUserWorkspaces).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledTimes(1);
    const params = mockSlackBinder.sendAgentPicker.mock.calls[0][1];
    expect(params.entries).toEqual([{ id: 'personal', isActive: true, title: 'Personal' }]);
  });

  it('rejects workspace scope button callbacks when workspace feature is disabled', async () => {
    mockFindLink.mockResolvedValue(personalLink);
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockListUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Workspace 1', role: 'owner' },
    ]);

    const router = new MessengerRouter();
    const ack = vi.fn();
    await (router as any).handleScopeCallback(
      { platform: 'slack', tenantId: '' },
      {
        callbackId: '',
        chatId: 'D_DM',
        data: 'messenger:scope:workspace-1',
        fromUserId: 'U_ALICE',
      },
      'workspace-1',
      ack,
    );

    expect(mockSetActiveScope).not.toHaveBeenCalled();
    expect(mockListUserWorkspaces).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ toast: 'Scope not found.' });
  });

  it('persists the scope switch and re-renders the picker when a scope button is tapped', async () => {
    mockFindLink.mockResolvedValue(personalLink);
    mockListUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Workspace 1', role: 'owner' },
    ]);
    // `fetchUserAgents` pins the inbox/LobeAI first; the switch lands on it.
    vi.spyOn(MessengerRouter.prototype as any, 'fetchUserAgents').mockResolvedValue([
      { id: 'agt_inbox', isPrivate: false, title: 'LobeAI' },
    ]);

    const router = new MessengerRouter();
    const ack = vi.fn();
    await (router as any).handleScopeCallback(
      { platform: 'slack', tenantId: '' },
      {
        callbackId: '',
        chatId: 'D_DM',
        data: 'messenger:scope:workspace-1',
        fromUserId: 'U_ALICE',
      },
      'workspace-1',
      ack,
    );

    // Active agent is set to the target scope's default (the inbox), not cleared.
    expect(mockSetActiveScope).toHaveBeenCalledWith(
      expect.anything(),
      'link_1',
      'workspace-1',
      'agt_inbox',
    );
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        toast: expect.stringContaining('Workspace 1'),
        updatedPicker: expect.objectContaining({
          action: 'scope',
          entries: [
            { id: 'personal', isActive: false, title: 'Personal' },
            { id: 'workspace-1', isActive: true, title: 'Workspace 1' },
          ],
        }),
      }),
    );
  });
});

/**
 * @example Guest /agents and /switch replies contain only a DM instruction.
 */
describe('MessengerRouter Telegram Guest command privacy', () => {
  // ROOT CAUSE:
  //
  // Guest Mode disables interactive pickers, so runAgentsCommand and
  // runSwitchCommand fell through to text lists and selection confirmations.
  // replyToMessage publishes those replies in the originating chat, revealing
  // private names and the active selection to other chat participants.
  // The fix redirects Guest commands before reading lists or changing state.
  /**
   * @example /agents 2 in a Guest chat must not switch or expose Private Agent B.
   * @example /switch in a Guest chat must not list Private Workspace.
   */
  it.each([
    '/agents',
    '/agents 1',
    '/agents 2',
    '/agents 99',
    '/switch',
    '/switch 1',
    '/switch 2',
    '/switch 99',
  ])('redirects Guest %s to DM without exposing or changing personal state', async (text) => {
    // Restore earlier grouping spies so these cases exercise real list rendering
    // against the database boundary mocks when run on the unfixed source.
    const fetchUserAgents = Reflect.get(MessengerRouter.prototype, 'fetchUserAgents');
    if (vi.isMockFunction(fetchUserAgents)) fetchUserAgents.mockRestore();
    mockListMessengerBindableAgents.mockResolvedValue([
      { id: 'agt_a', isPrivate: true, title: 'Private Agent A' },
      { id: 'agt_b', isPrivate: true, title: 'Private Agent B' },
    ]);
    mockListUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1', name: 'Private Workspace', role: 'owner' },
    ]);
    await loadTelegramBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_a',
      id: 'link_1',
      platformUserId: '123',
      tenantId: '',
      userId: 'user_alice',
      workspaceId: null,
    });
    mockTelegramBinder.isOneShotMessage.mockReturnValue(true);
    const handler = mockChatBot.onNewMention.mock.calls[0][0];
    const message = fakeMessage({
      author: { isBot: false, userId: '123', userName: 'alice' },
      isMention: true,
      raw: { guest_query_id: 'gq-private-command' },
      text,
    });
    await handler(
      { id: 'telegram:guest:-100123:bot:999:message:55', isDM: false, post: vi.fn() },
      message,
    );

    /** @example Exactly one safe reply, without lists, active markers or selection feedback. */
    expect(mockTelegramBinder.replyToMessage.mock.calls).toEqual([
      [
        message,
        `Open your direct message with the LobeHub bot and send \`${text.split(' ')[0]}\` there.`,
      ],
    ]);
    /** @example No picker or extra DM is sent while answering the Guest query. */
    expect(mockTelegramBinder.sendAgentPicker).not.toHaveBeenCalled();
    /** @example The user opens the DM explicitly; the bot does not initiate one. */
    expect(mockTelegramBinder.sendDmText).not.toHaveBeenCalled();
    /** @example /agents 2 cannot change the user's active agent from a Guest chat. */
    expect(mockSetActiveAgentById).not.toHaveBeenCalled();
    /** @example /switch 2 cannot change the user's active workspace from a Guest chat. */
    expect(mockSetActiveScope).not.toHaveBeenCalled();
  });

  /** @example Ordinary Telegram bot DMs continue showing the requested picker. */
  it.each(['/agents', '/switch'])('keeps %s available in an ordinary Telegram DM', async (text) => {
    const fetchUserAgents = Reflect.get(MessengerRouter.prototype, 'fetchUserAgents');
    if (vi.isMockFunction(fetchUserAgents)) fetchUserAgents.mockRestore();
    mockListMessengerBindableAgents.mockResolvedValue([
      { id: 'agt_a', isPrivate: true, title: 'Private Agent A' },
    ]);
    await loadTelegramBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_a',
      id: 'link_1',
      platformUserId: '123',
      tenantId: '',
      userId: 'user_alice',
      workspaceId: null,
    });
    const handler = mockChatBot.onNewMention.mock.calls[0][0];
    await handler(
      { id: 'telegram:123', isDM: true, post: vi.fn() },
      fakeMessage({ author: { isBot: false, userId: '123', userName: 'alice' }, text }),
    );

    /** @example The picker remains usable and visible only inside the DM. */
    expect(mockTelegramBinder.sendAgentPicker).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({ ephemeralTo: undefined }),
    );
    /** @example Ordinary DM commands never consume a Guest query. */
    expect(mockTelegramBinder.replyToMessage).not.toHaveBeenCalled();
  });
});

describe('MessengerRouter overlapping messages', () => {
  const wechatLink = {
    activeAgentId: 'agt_main',
    id: 'link_wechat',
    platformUserId: 'wechat-user',
    tenantId: 'wechat-user',
    userId: 'user_alice',
    workspaceId: null,
  };

  const chatConfig = () => (Chat as unknown as { mock: { calls: any[][] } }).mock.calls.at(-1)![0];

  it('collects a burst window on WeChat instead of dispatching each message alone', async () => {
    // WeChat sends an image and the sentence about it as two webhooks a few
    // hundred ms apart. Without the window the picture starts its own run and
    // the sentence arrives while that run still owns the topic.
    await loadWechatBot();

    expect(chatConfig().concurrency).toEqual({
      debounceMs: expect.any(Number),
      strategy: 'burst',
    });
  });

  it('keeps the plain queue on platforms that send media together with its caption', async () => {
    await loadSlackBot();

    expect(chatConfig().concurrency).toBe('queue');
  });

  it('folds the collected messages into the single turn handed to the agent', async () => {
    await loadWechatBot();
    mockFindLink.mockResolvedValue(wechatLink);

    const handler = mockChatBot.onSubscribedMessage.mock.calls.at(-1)![0] as (
      thread: any,
      msg: any,
      context?: any,
    ) => Promise<void>;
    await handler(fakeWechatDmThread(), fakeMessage({ id: 'm2', text: '参考这个风格说话' }), {
      skipped: [fakeMessage({ attachments: [{ type: 'image' }], id: 'm1', text: '' })],
      totalSinceLastHandler: 2,
    });

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    const dispatched = mockHandleSubscribed.mock.calls[0][1];
    expect(dispatched.text).toBe('参考这个风格说话');
    // The image rides along instead of being answered as its own turn, and each
    // source stays reachable so its media can still be downloaded.
    expect(dispatched.attachments).toEqual([{ type: 'image' }]);
    expect(dispatched.sourceMessages.map((m: any) => m.id)).toEqual(['m1', 'm2']);
  });

  it.each(['onSubscribedMessage', 'onNewMention'] as const)(
    '%s never dispatches another sender content under the linked owner',
    async (entry) => {
      await loadSlackBot();
      mockFindLink.mockResolvedValue({
        activeAgentId: 'agt_main',
        id: 'link_1',
        platformUserId: 'U_ALICE',
        tenantId: 'T_ACME',
        userId: 'user_alice',
      });
      const handler = mockChatBot[entry].mock.calls.at(-1)![0];
      await handler(
        fakeChannelThread(),
        fakeMessage({ id: 'owner', isMention: true, text: 'owner request' }),
        {
          skipped: [
            fakeMessage({
              author: { isBot: false, userId: 'U_OTHER', userName: 'other' },
              id: 'other',
              isMention: true,
              text: 'untrusted instruction',
              attachments: [{ type: 'image' }],
            }),
          ],
          totalSinceLastHandler: 2,
        },
      );
      const dispatch = entry === 'onSubscribedMessage' ? mockHandleSubscribed : mockHandleMention;
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][1].text).toBe('owner request');
      expect(dispatch.mock.calls[0][1].attachments ?? []).toEqual([]);
      expect(mockAppendToList).toHaveBeenCalledWith(
        expect.any(String),
        'U_OTHER',
        expect.any(Object),
      );
    },
  );

  it('does not use another sender mention to wake an unmentioned owner turn', async () => {
    await loadSlackBot();
    mockGetList.mockResolvedValue(['U_ALICE', 'U_OTHER']);
    const handler = mockChatBot.onSubscribedMessage.mock.calls.at(-1)![0];
    await handler(
      fakeChannelThread(),
      fakeMessage({ id: 'owner', isMention: false, text: 'owner chatter' }),
      {
        skipped: [
          fakeMessage({
            author: { isBot: false, userId: 'U_OTHER', userName: 'other' },
            id: 'other',
            isMention: true,
          }),
        ],
        totalSinceLastHandler: 2,
      },
    );
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    expect(mockFindLink).not.toHaveBeenCalled();
  });

  it('treats a mention anywhere in the collected turn as addressed to the bot', async () => {
    // The last message of a burst usually carries the question without the `@`.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    mockGetList.mockResolvedValue(['U_ALICE', 'U_BOB']);

    const handler = mockChatBot.onSubscribedMessage.mock.calls.at(-1)![0] as (
      thread: any,
      msg: any,
      context?: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ id: 'm2', isMention: false }), {
      skipped: [fakeMessage({ id: 'm1', isMention: true, text: '<@U_BOT> 看看这个' })],
      totalSinceLastHandler: 2,
    });

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment node
import { Chat } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentBridgeService } from '@/server/services/bot/AgentBridgeService';

import { getMessengerSystemStrings } from '../systemReply';
import { MessengerRouter } from './index';
import {
  buildSlackRequest,
  fakeDmThread,
  fakeMessage,
  loadSlackBot,
  loadTelegramBot,
  mockAgentExistsById,
  mockChatBot,
  mockFindLink,
  mockHandleMention,
  mockListMessengerBindableAgents,
  mockResolveByKey,
  mockResolveByPayload,
  mockSetActiveAgentById,
  mockSetIfNotExists,
  mockSlackBinder,
  mockTelegramBinder,
  resetMessengerRouterMocks,
  slackCreds,
} from './testUtils';

/**
 * Characterization of router flows the scenario suites did not reach: text
 * `/stop`, `/feedback` and `/help`, the dispatch guards (no active agent,
 * stale agent, lookup failure), unknown and Telegram-group slash commands,
 * agent-switch callbacks, the Slack App Home welcome, deferred replay, the
 * platform command menu and bot invalidation.
 */

const mockSubmitBotFeedback = vi.hoisted(() => vi.fn());
const mockDrainDeferred = vi.hoisted(() => vi.fn());
const mockBuildReplayMessages = vi.hoisted(() => vi.fn());

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
// The shared template stub has no `renderFeedbackSubmitted`; add one so the
// `/feedback` success reply is observable.
vi.mock('@/server/services/bot/replyTemplate', async () => ({
  ...(await import('./testUtils')).replyTemplateModule(),
  renderFeedbackSubmitted: (issueUrl?: string) => `feedback submitted ${issueUrl ?? ''}`.trim(),
}));
vi.mock('../platforms/slack/binder', async () => (await import('./testUtils')).slackBinderModule());
vi.mock('../platforms/telegram/binder', async () =>
  (await import('./testUtils')).telegramBinderModule(),
);
vi.mock('../platforms/wechat/binder', async () =>
  (await import('./testUtils')).wechatBinderModule(),
);
vi.mock('../platforms/linq/binder', async () => (await import('./testUtils')).linqBinderModule());
vi.mock('../platforms/linq/webhook', async () => (await import('./testUtils')).linqWebhookModule());
vi.mock('@/server/services/bot/feedbackSubmit', () => ({
  submitBotFeedback: mockSubmitBotFeedback,
}));
vi.mock('@/server/services/bot/deferredMessages', () => ({
  MAX_DEFERRED_PER_THREAD: 20,
  replayDeferredBotMessages: async (
    applicationId: string,
    threadId: string,
    replay: (entries: unknown[]) => Promise<void>,
  ) => {
    const entries = await mockDrainDeferred(applicationId, threadId);
    if (entries.length) await replay(entries);
  },
}));
vi.mock('@/server/services/bot/mergeMessages', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildReplayMessages: mockBuildReplayMessages,
}));

const strings = getMessengerSystemStrings('slack');
const bridgeStatics = AgentBridgeService as unknown as Record<
  'clearActiveThread' | 'getActiveOperationId' | 'isThreadActive' | 'requestStop',
  ReturnType<typeof vi.fn>
>;

const LINK = {
  activeAgentId: 'agt_a',
  id: 'link_1',
  platformUserId: 'U_ALICE',
  tenantId: 'T_ACME',
  userId: 'user_alice',
  workspaceId: null,
};

const AGENT_ROWS = [
  { id: 'agt_a', isPrivate: false, title: 'A' },
  { id: 'agt_b', isPrivate: false, title: 'B' },
];

/** Drive the first-touch DM handler with a text message. */
const sendDm = async (text: string) => {
  await loadSlackBot();
  const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
    thread: any,
    msg: any,
  ) => Promise<void>;
  const thread = fakeDmThread();
  await handler(thread, fakeMessage({ text }));
  return thread;
};

const restoreSlackBinder: Array<() => void> = [];
const patchSlackBinder = (patch: Record<string, unknown>) => {
  const binder = mockSlackBinder as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, binder[key]]));
  Object.assign(binder, patch);
  restoreSlackBinder.push(() => Object.assign(binder, previous));
};

beforeEach(() => {
  resetMessengerRouterMocks();
  mockListMessengerBindableAgents.mockResolvedValue(AGENT_ROWS);
  mockDrainDeferred.mockResolvedValue([]);
});

afterEach(() => {
  while (restoreSlackBinder.length) restoreSlackBinder.pop()!();
  vi.clearAllMocks();
});

describe('MessengerRouter text commands', () => {
  it('/stop asks an unlinked sender to /start first', async () => {
    mockFindLink.mockResolvedValue(null);

    await sendDm('/stop');

    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', strings.needLink);
    expect(bridgeStatics.isThreadActive).not.toHaveBeenCalled();
  });

  it('/stop reports when nothing is running', async () => {
    mockFindLink.mockResolvedValue(LINK);
    bridgeStatics.isThreadActive.mockReturnValue(false);

    await sendDm('/stop');

    expect(bridgeStatics.isThreadActive).toHaveBeenCalledWith('slack:D_DM');
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', strings.stopNotActive);
  });

  it('/stop queues a deferred stop while the run has no operation id yet', async () => {
    mockFindLink.mockResolvedValue(LINK);
    bridgeStatics.isThreadActive.mockReturnValue(true);
    bridgeStatics.getActiveOperationId.mockReturnValue(undefined);

    await sendDm('/stop');

    expect(bridgeStatics.requestStop).toHaveBeenCalledWith('slack:D_DM');
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', strings.stopRequested);
  });

  it('/stop replies "unable" when the interrupt throws', async () => {
    mockFindLink.mockResolvedValue(LINK);
    bridgeStatics.isThreadActive.mockReturnValue(true);
    // The AiAgentService stub has no `interruptTask`, so the call throws.
    bridgeStatics.getActiveOperationId.mockReturnValue('op-1');

    await sendDm('/stop');

    expect(bridgeStatics.clearActiveThread).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', strings.stopUnable);
  });

  it.each([
    ['an empty body', '/feedback', undefined, 'cmdFeedbackUsage'],
    ['a failed submission', '/feedback slow', { success: false }, 'cmdFeedbackError'],
    [
      'a successful submission',
      '/feedback slow',
      { issueUrl: 'https://example.com/i/1', success: true },
      'feedback submitted https://example.com/i/1',
    ],
  ] as const)('/feedback replies for %s', async (_label, text, result, expected) => {
    mockFindLink.mockResolvedValue(LINK);
    if (result) mockSubmitBotFeedback.mockResolvedValue(result);

    await sendDm(text);

    if (result) {
      expect(mockSubmitBotFeedback).toHaveBeenCalledWith(expect.anything(), {
        body: 'slow',
        platform: 'slack',
        threadId: 'slack:D_DM',
        userId: 'user_alice',
      });
    } else {
      expect(mockSubmitBotFeedback).not.toHaveBeenCalled();
    }
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', expected);
  });

  it('/help replies with the usage text', async () => {
    mockFindLink.mockResolvedValue(null);

    await sendDm('/help');

    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', strings.help);
  });
});

describe('MessengerRouter dispatch guards', () => {
  it('prompts for /agents when the link has no active agent', async () => {
    mockFindLink.mockResolvedValue({ ...LINK, activeAgentId: null });

    await sendDm('hello');

    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', strings.noActiveAgent);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('reports a stale binding when the active agent no longer resolves', async () => {
    mockFindLink.mockResolvedValue(LINK);
    mockAgentExistsById.mockResolvedValue(false);

    await sendDm('hello');

    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith('D_DM', strings.staleAgent);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('posts the generic error in the thread when the link lookup fails', async () => {
    mockFindLink.mockRejectedValue(new Error('db down'));

    const thread = await sendDm('hello');

    expect(thread.post).toHaveBeenCalledWith(strings.genericError);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });
});

describe('MessengerRouter slash edge cases', () => {
  it('answers an unregistered slash command with the unknown-command reply', async () => {
    await loadSlackBot();
    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    const event = {
      channel: { id: 'slack:C_GENERAL', isDM: false },
      command: '/bogus',
      text: '',
      user: { userId: 'U_ALICE', userName: 'alice' },
    };

    await handler(event);

    expect(mockFindLink).not.toHaveBeenCalled();
    expect(mockSlackBinder.replyPrivately).toHaveBeenCalledWith(
      event.channel,
      event.user,
      strings.unknownCommand('bogus'),
    );
  });

  it('keeps the link flow out of a Telegram group: /start posts a DM-only notice', async () => {
    await loadTelegramBot();
    mockFindLink.mockResolvedValue(null);
    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    const channel = { id: 'telegram:-100200', isDM: false, post: vi.fn() };

    await handler({ channel, command: '/start', text: '', user: { userId: '42' } });

    expect(channel.post).toHaveBeenCalledWith(
      getMessengerSystemStrings('telegram').startDirectMessageOnly,
    );
    expect(mockTelegramBinder.handleUnlinkedMessage).not.toHaveBeenCalled();
    expect(mockTelegramBinder.sendDmText).not.toHaveBeenCalled();
  });
});

describe('MessengerRouter agent-switch callbacks', () => {
  const tap = async (data: string, binderPatch: Record<string, unknown> = {}) => {
    const acknowledgeCallback = vi.fn();
    const binder = { ...mockSlackBinder, acknowledgeCallback, ...binderPatch };
    await (new MessengerRouter() as any).handleCallbackAction(binder, slackCreds('T_ACME'), {
      chatId: 'D_DM',
      data,
      fromUserId: 'U_ALICE',
      messageId: '1',
    });
    return acknowledgeCallback;
  };

  it('ignores taps when the binder cannot acknowledge them', async () => {
    await tap('messenger:switch:agt_b', { acknowledgeCallback: undefined });

    expect(mockFindLink).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown action', 'messenger:unknown', LINK, strings.unknownAction],
    ['an unlinked user', 'messenger:switch:agt_b', null, strings.notLinked],
    ['a missing agent', 'messenger:switch:agt_zzz', LINK, strings.agentNotFound],
    ['the already-active agent', 'messenger:switch:agt_a', LINK, 'A is already active.'],
  ])('acks %s with a toast only', async (_label, data, link, toast) => {
    mockFindLink.mockResolvedValue(link);

    const ack = await tap(data);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ data }), { toast });
    expect(mockSetActiveAgentById).not.toHaveBeenCalled();
  });

  it('switches the active agent and re-renders the picker', async () => {
    mockFindLink.mockResolvedValue(LINK);

    const ack = await tap('messenger:switch:agt_b');

    expect(mockSetActiveAgentById).toHaveBeenCalledWith(expect.anything(), 'link_1', 'agt_b');
    expect(ack).toHaveBeenCalledWith(expect.anything(), {
      toast: strings.activeAgentChangedToast('B'),
      updatedPicker: {
        entries: [
          { id: 'agt_a', isActive: false, title: 'A' },
          { id: 'agt_b', isActive: true, title: 'B' },
        ],
        text: strings.receiveMessagesPicker,
      },
    });
  });

  it('routes chat-sdk action events through the same callback handler', async () => {
    mockFindLink.mockResolvedValue(LINK);
    const acknowledgeCallback = vi.fn();
    const extractActionFromEvent = vi.fn(() => ({
      chatId: 'D_DM',
      data: 'messenger:switch:agt_b',
      fromUserId: 'U_ALICE',
      messageId: '1',
    }));
    patchSlackBinder({ acknowledgeCallback, extractActionFromEvent });
    await loadSlackBot();
    const onAction = mockChatBot.onAction.mock.calls[0][0] as (event: any) => Promise<void>;

    await onAction({ id: 'evt' });

    expect(extractActionFromEvent).toHaveBeenCalledWith({ id: 'evt' }, expect.anything());
    expect(mockSetActiveAgentById).toHaveBeenCalledWith(expect.anything(), 'link_1', 'agt_b');
    expect(acknowledgeCallback).toHaveBeenCalledTimes(1);
  });
});

describe('MessengerRouter Slack App Home welcome', () => {
  const openAppHome = async () => {
    patchSlackBinder({
      extractAppHomeOpened: vi.fn().mockResolvedValue({ channelId: 'D_HOME', userId: 'U_ALICE' }),
    });
    mockResolveByPayload.mockResolvedValue(slackCreds('T_ACME'));
    return new MessengerRouter().getWebhookHandler('slack')(
      buildSlackRequest(
        JSON.stringify({ authorizations: [{ team_id: 'T_ACME' }], type: 'event_callback' }),
      ),
    );
  };

  it('welcomes a linked user once, naming the active agent', async () => {
    mockFindLink.mockResolvedValue(LINK);

    const res = await openAppHome();

    expect(res.status).toBe(200);
    expect(mockSetIfNotExists).toHaveBeenCalledWith('app_home_welcomed:U_ALICE', '1');
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledWith(
      'D_HOME',
      'Welcome to LobeHub! Your active agent is *A*. Send a message to chat, or use `/agents` to switch.',
    );
  });

  it('sends the link prompt to an unlinked user', async () => {
    mockFindLink.mockResolvedValue(null);

    await openAppHome();

    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledWith({
      authorUserId: 'U_ALICE',
      chatId: 'D_HOME',
    });
    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });

  it('stays silent on a repeat open', async () => {
    mockSetIfNotExists.mockResolvedValue(false);

    await openAppHome();

    expect(mockFindLink).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });
});

describe('MessengerRouter bot lifecycle', () => {
  it('replays deferred messages through the install adapter', async () => {
    const adapter = { name: 'slack-adapter' };
    patchSlackBinder({
      createClient: () => ({
        createAdapter: () => ({ slack: adapter }),
        extractChatId: (id: string) => id.split(':')[1] ?? id,
      }),
    });
    const processMessage = vi.fn().mockResolvedValue(undefined);
    (mockChatBot as Record<string, unknown>).processMessage = processMessage;
    mockResolveByKey.mockResolvedValue(slackCreds('T_ACME'));
    mockDrainDeferred.mockResolvedValue([{ id: 'm1' }]);
    mockBuildReplayMessages.mockReturnValue([{ id: 'm1:replay' }]);

    try {
      await new MessengerRouter().replayDeferredMessages(
        'slack:T_ACME',
        'messenger-slack-T_ACME',
        'slack:D_DM',
      );
    } finally {
      delete (mockChatBot as Record<string, unknown>).processMessage;
    }

    expect(mockDrainDeferred).toHaveBeenCalledWith('messenger-slack-T_ACME', 'slack:D_DM');
    expect(mockResolveByKey).toHaveBeenCalledWith('slack:T_ACME');
    expect(processMessage).toHaveBeenCalledWith(adapter, 'slack:D_DM', { id: 'm1:replay' });
  });

  it('dispatches every deferred message together and rethrows the first failure', async () => {
    const adapter = { name: 'slack-adapter' };
    patchSlackBinder({
      createClient: () => ({
        createAdapter: () => ({ slack: adapter }),
        extractChatId: (id: string) => id.split(':')[1] ?? id,
      }),
    });
    let releaseFirst!: (error: Error) => void;
    const started: string[] = [];
    const processMessage = vi.fn((_adapter: unknown, _thread: string, message: { id: string }) => {
      started.push(message.id);
      if (message.id === 'm1:replay') {
        return new Promise<void>((_resolve, reject) => {
          releaseFirst = reject;
        });
      }
      return Promise.resolve();
    });
    (mockChatBot as Record<string, unknown>).processMessage = processMessage;
    mockResolveByKey.mockResolvedValue(slackCreds('T_ACME'));
    mockDrainDeferred.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    mockBuildReplayMessages.mockReturnValue([{ id: 'm1:replay' }, { id: 'm2:replay' }]);

    try {
      const replay = new MessengerRouter().replayDeferredMessages(
        'slack:T_ACME',
        'messenger-slack-T_ACME',
        'slack:D_DM',
      );
      await vi.waitFor(() => expect(started).toEqual(['m1:replay', 'm2:replay']));
      releaseFirst(new Error('dispatch failed'));
      await expect(replay).rejects.toThrow('dispatch failed');
    } finally {
      delete (mockChatBot as Record<string, unknown>).processMessage;
    }
  });

  it('fails the replay when the install has no adapter for the platform', async () => {
    mockResolveByKey.mockResolvedValue(slackCreds('T_ACME'));
    mockDrainDeferred.mockResolvedValue([{ id: 'm1' }]);

    await expect(
      new MessengerRouter().replayDeferredMessages(
        'slack:T_ACME',
        'messenger-slack-T_ACME',
        'slack:D_DM',
      ),
    ).rejects.toThrow('Messenger adapter unavailable for slack');
  });

  it('registers the platform command menu with every command and its options', async () => {
    const registerBotCommands = vi.fn().mockResolvedValue(undefined);
    patchSlackBinder({
      createClient: () => ({
        createAdapter: () => ({}),
        extractChatId: (id: string) => id.split(':')[1] ?? id,
        registerBotCommands,
      }),
    });

    await loadSlackBot();

    const list = registerBotCommands.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(list.map((c) => c.command)).toEqual([
      'start',
      'agents',
      'switch',
      'new',
      'mode',
      'stop',
      'feedback',
      'help',
    ]);
    expect(list.find((c) => c.command === 'feedback')).toEqual({
      command: 'feedback',
      description: 'Send feedback directly to the LobeHub team (no AI reply)',
      options: [{ description: 'Your feedback message', name: 'message', required: true }],
    });
  });

  it('rebuilds the bot after invalidateBot', async () => {
    mockResolveByPayload.mockResolvedValue(slackCreds('T_ACME'));
    const router = new MessengerRouter();
    const deliver = () =>
      router.getWebhookHandler('slack')(
        buildSlackRequest(
          JSON.stringify({ authorizations: [{ team_id: 'T_ACME' }], type: 'event_callback' }),
        ),
      );

    await deliver();
    await deliver();
    expect(Chat).toHaveBeenCalledTimes(1);

    router.invalidateBot('slack:T_ACME');
    await deliver();
    expect(Chat).toHaveBeenCalledTimes(2);
  });
});

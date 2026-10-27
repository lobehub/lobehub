import type { ChatTopicBotContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  findById: vi.fn(),
  linkDeleteByPlatform: vi.fn(),
  startClient: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: vi.fn().mockImplementation(function () {
    return { delete: mocks.delete, findById: mocks.findById, update: mocks.update };
  }),
}));
vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation(function () {
    return { deleteByPlatform: mocks.linkDeleteByPlatform, list: vi.fn(async () => []) };
  }),
}));
vi.mock('@/server/services/gateway', () => ({
  GatewayService: vi.fn().mockImplementation(function () {
    return { startClient: mocks.startClient };
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/server/services/messenger', () => ({
  getMessengerRouter: () => ({ invalidateBot: vi.fn() }),
  messengerPlatformRegistry: { listSerializedPlatforms: vi.fn(() => []) },
}));
vi.mock('@/server/services/messenger/push', () => ({ sendMessengerPush: vi.fn() }));
// Keeps the settings helpers' transitive imports (BotMessageRouter -> ModelRuntime) out of the
// test runtime; the guard under test runs before any of them.
vi.mock('@/server/services/bot/agentBotProviderSettings', () => ({
  assertBotAccessSettings: vi.fn(),
  assertWatchKeywordsWritable: vi.fn(),
  invalidateBotAfterUpdate: vi.fn().mockResolvedValue(undefined),
  mergeBotSettingsForPersist: vi.fn((_platform: string, settings: unknown) => settings),
  mergeBotSettingsPatch: vi.fn(
    (
      _platform: string,
      existing: Record<string, unknown> | null,
      patch: Record<string, unknown>,
    ) => ({
      ...existing,
      ...patch,
    }),
  ),
}));

const { messageRuntime } = await import('./index');

const OWNER_ONLY = "Only the bot's owner can change its settings";

const botContext = (isOwner: boolean): ChatTopicBotContext => ({
  applicationId: 'app-1',
  isOwner,
  platform: 'discord',
  platformThreadId: 'discord:g1:c1',
  senderExternalUserId: isOwner ? 'owner-id' : 'stranger-id',
});

const runtimeFor = (bot?: ChatTopicBotContext) =>
  messageRuntime.factory({
    botContext: bot,
    serverDB: {} as any,
    toolManifestMap: {},
    userId: 'user-1',
  } satisfies ToolExecutionContext);

const BOT_ROW = {
  applicationId: 'app-1',
  enabled: true,
  id: 'bot-1',
  platform: 'discord',
  settings: { dmPolicy: 'open', watchKeywords: [] },
  workspaceId: null,
};

describe('messageRuntime: only the owner changes a bot from a bot conversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue(BOT_ROW);
    mocks.startClient.mockResolvedValue('connecting');
  });

  it('refuses every bot and messenger mutation when someone else is talking to the bot', async () => {
    const runtime = await runtimeFor(botContext(false));

    const results = [
      await runtime.updateBot({
        botId: 'bot-1',
        settings: { watchKeywords: [{ asName: true, keyword: 'canis' }] },
      }),
      await runtime.toggleBot({ botId: 'bot-1', enabled: false }),
      await runtime.deleteBot({ botId: 'bot-1' }),
      await runtime.connectBot({ botId: 'bot-1' }),
      await runtime.createBot({
        agentId: 'agt-1',
        applicationId: 'app-2',
        credentials: { botToken: 'x' },
        platform: 'discord',
      }),
      await runtime.uninstallMessenger({ installationId: 'inst-1' }),
      await runtime.setMessengerActiveAgent({ agentId: null, platform: 'slack' }),
      await runtime.unlinkMessenger({ platform: 'slack' }),
    ];

    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.content).toContain(OWNER_ONLY);
    }
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.startClient).not.toHaveBeenCalled();
    expect(mocks.linkDeleteByPlatform).not.toHaveBeenCalled();
  });

  it('still lets anyone read the bot settings', async () => {
    const runtime = await runtimeFor(botContext(false));

    const result = await runtime.getBotDetail({ botId: 'bot-1' });

    expect(result.success).toBe(true);
  });

  it('lets the owner change the bot from a bot conversation', async () => {
    const runtime = await runtimeFor(botContext(true));
    const settings = { watchKeywords: [{ asName: true, keyword: 'canis' }] };

    const result = await runtime.updateBot({ botId: 'bot-1', settings });

    expect(result.success).toBe(true);
    // Through the partial-update merge: keys the agent did not send keep their stored values.
    expect(mocks.update).toHaveBeenCalledWith('bot-1', {
      settings: { dmPolicy: 'open', watchKeywords: settings.watchKeywords },
    });
  });

  it('leaves a run outside any bot conversation unchanged', async () => {
    const runtime = await runtimeFor();

    const result = await runtime.toggleBot({ botId: 'bot-1', enabled: false });

    expect(result.success).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith('bot-1', { enabled: false });
  });
});

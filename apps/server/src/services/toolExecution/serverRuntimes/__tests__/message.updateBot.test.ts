// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mockFindById = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: vi.fn().mockImplementation(function () {
    return { findById: mockFindById, update: mockUpdate };
  }),
}));
vi.mock('@/business/server/bot/featureAccess', () => ({
  assertBotFeatureAccess: vi.fn().mockResolvedValue(undefined),
  BotFeatureAccessError: class extends Error {},
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/server/services/gateway/runtimeStatus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBotRuntimeStatus: vi.fn().mockResolvedValue({ status: 'connected' }),
}));
// The real settings merge, without the router and gateway it reaches for on invalidation.
vi.mock('@/server/services/bot/BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ invalidateBot: vi.fn() }),
}));
vi.mock('@/server/services/gateway', () => ({
  GatewayService: vi.fn(function () {
    return { stopClient: vi.fn(), useMessageGateway: false };
  }),
}));

// Kept out of the module graph, as in `message.test.ts`: they pull in the tool registry.
vi.mock('@/server/services/messenger', () => ({
  getMessengerRouter: () => ({ invalidateBot: vi.fn() }),
  messengerPlatformRegistry: { listSerializedPlatforms: vi.fn() },
}));
vi.mock('@/server/services/messenger/installations', () => ({
  getInstallationStore: vi.fn(),
}));
vi.mock('@/server/services/messenger/push', () => ({ sendMessengerPush: vi.fn() }));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

const { messageRuntime } = await import('../message');

const context: ToolExecutionContext = {
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
};

const STORED = {
  allowFrom: [{ id: 'u-1' }],
  botWakeDisabled: false,
  dmPolicy: 'open',
  userId: 'owner-1',
  watchKeywords: [{ keyword: 'bug' }],
};

describe('message runtime: the agent maintains its own duties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({
      applicationId: 'app-1',
      enabled: true,
      id: 'bot-1',
      platform: 'discord',
      settings: STORED,
    });
  });

  it('updateBot persists the duties as a partial update, keeping every other setting', async () => {
    const runtime = await messageRuntime.factory(context);

    const result = await runtime.updateBot({
      botId: 'bot-1',
      settings: { botWakeDuties: '评估群里描述的需求', botWakeDutiesThreshold: 0.7 },
    });

    expect(result.success).toBe(true);
    const [id, value] = mockUpdate.mock.calls[0];
    expect(id).toBe('bot-1');
    expect(value.settings).toMatchObject({
      ...STORED,
      botWakeDuties: '评估群里描述的需求',
      botWakeDutiesThreshold: 0.7,
    });
  });

  it('getBotDetail shows the duties under the key updateBot writes, even from a nested botWake', async () => {
    mockFindById.mockResolvedValue({
      applicationId: 'app-1',
      enabled: true,
      id: 'bot-1',
      platform: 'discord',
      settings: { botWake: { duties: { text: 'Triage bugs.' }, enabled: true } },
    });
    const runtime = await messageRuntime.factory(context);

    const result = await runtime.getBotDetail({ botId: 'bot-1' });

    expect(result.content).toContain('"botWakeDuties":"Triage bugs."');
  });
});

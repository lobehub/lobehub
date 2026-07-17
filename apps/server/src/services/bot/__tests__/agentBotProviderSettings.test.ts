import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertWatchKeywordsWritable, invalidateBotAfterUpdate } from '../agentBotProviderSettings';

const mockAssertBotFeatureAccess = vi.hoisted(() => vi.fn());
const mockStopClient = vi.hoisted(() => vi.fn());
const mockInvalidateBot = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/bot/featureAccess', () => ({
  assertBotFeatureAccess: mockAssertBotFeatureAccess,
}));

vi.mock('@/server/services/gateway', () => ({
  GatewayService: vi.fn(() => ({ stopClient: mockStopClient })),
}));

vi.mock('../BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ invalidateBot: mockInvalidateBot }),
}));

describe('assertWatchKeywordsWritable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertBotFeatureAccess.mockResolvedValue(undefined);
  });

  const base = { platform: 'discord', userId: 'user-1' };

  it('skips when settings are not part of the write', async () => {
    await assertWatchKeywordsWritable({ ...base, settings: undefined });
    expect(mockAssertBotFeatureAccess).not.toHaveBeenCalled();
  });

  it('skips when no keywords are configured (including clearing them)', async () => {
    await assertWatchKeywordsWritable({
      ...base,
      existingSettings: { watchKeywords: [{ keyword: 'bug' }] },
      settings: { watchKeywords: [] },
    });
    expect(mockAssertBotFeatureAccess).not.toHaveBeenCalled();
  });

  it('skips when the keyword set is unchanged (unrelated settings save)', async () => {
    await assertWatchKeywordsWritable({
      ...base,
      existingSettings: { watchKeywords: [{ keyword: 'bug' }] },
      settings: { charLimit: 500, watchKeywords: [{ keyword: 'bug' }] },
    });
    expect(mockAssertBotFeatureAccess).not.toHaveBeenCalled();
  });

  it('asserts feature access when keywords are first added', async () => {
    await assertWatchKeywordsWritable({
      ...base,
      applicationId: 'app-1',
      settings: { watchKeywords: [{ keyword: 'bug' }] },
      workspaceId: 'ws-1',
    });

    expect(mockAssertBotFeatureAccess).toHaveBeenCalledWith({
      action: 'manage',
      applicationId: 'app-1',
      feature: 'messageMonitoring',
      platform: 'discord',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('asserts feature access when the keyword set changes', async () => {
    await assertWatchKeywordsWritable({
      ...base,
      existingSettings: { watchKeywords: [{ keyword: 'bug' }] },
      settings: { watchKeywords: [{ keyword: 'bug' }, { keyword: 'outage' }] },
    });
    expect(mockAssertBotFeatureAccess).toHaveBeenCalledTimes(1);
  });

  it('propagates the denial from assertBotFeatureAccess', async () => {
    mockAssertBotFeatureAccess.mockRejectedValueOnce(new Error('paid plan required'));

    await expect(
      assertWatchKeywordsWritable({
        ...base,
        settings: { watchKeywords: [{ keyword: 'bug' }] },
      }),
    ).rejects.toThrow('paid plan required');
  });
});

describe('invalidateBotAfterUpdate — monitoring capability flips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStopClient.mockResolvedValue(undefined);
    mockInvalidateBot.mockResolvedValue(undefined);
  });

  const target = {
    applicationId: 'app-1',
    platform: 'discord',
    userId: 'user-1',
  };

  it('stops the runtime when watch keywords go from none to some', async () => {
    await invalidateBotAfterUpdate(
      { ...target, settings: {} },
      { settings: { watchKeywords: [{ keyword: 'bug' }] } },
    );

    expect(mockStopClient).toHaveBeenCalledWith('discord', 'app-1', 'user-1');
    expect(mockInvalidateBot).toHaveBeenCalledWith('discord', 'app-1');
  });

  it('stops the runtime when watch keywords are cleared', async () => {
    await invalidateBotAfterUpdate(
      { ...target, settings: { watchKeywords: [{ keyword: 'bug' }] } },
      { settings: { watchKeywords: [] } },
    );

    expect(mockStopClient).toHaveBeenCalledTimes(1);
  });

  it('does not stop webhook-mode runtimes on keyword flips (no auto-reconnect exists)', async () => {
    // Gateway reconciliation skips webhook-mode providers, so a stop here
    // would take the bot offline until the next manual config save.
    await invalidateBotAfterUpdate(
      { ...target, platform: 'telegram', settings: {} },
      { settings: { watchKeywords: [{ keyword: 'bug' }] } },
    );

    expect(mockStopClient).not.toHaveBeenCalled();
    expect(mockInvalidateBot).toHaveBeenCalledTimes(1);
  });

  it('does not stop the runtime when settings switch the bot into webhook mode', async () => {
    await invalidateBotAfterUpdate(
      { ...target, settings: {} },
      { settings: { connectionMode: 'webhook', watchKeywords: [{ keyword: 'bug' }] } },
    );

    expect(mockStopClient).not.toHaveBeenCalled();
  });

  it('does not stop the runtime when keyword presence is unchanged', async () => {
    await invalidateBotAfterUpdate(
      { ...target, settings: { watchKeywords: [{ keyword: 'bug' }] } },
      { settings: { watchKeywords: [{ keyword: 'outage' }] } },
    );

    expect(mockStopClient).not.toHaveBeenCalled();
    expect(mockInvalidateBot).toHaveBeenCalledTimes(1);
  });

  it('does not stop the runtime for settings-free updates', async () => {
    await invalidateBotAfterUpdate({ ...target, settings: {} }, {});

    expect(mockStopClient).not.toHaveBeenCalled();
    expect(mockInvalidateBot).toHaveBeenCalledTimes(1);
  });
});

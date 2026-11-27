// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isBotAsleep } from './botSleep';

const mockGetBotSleepState = vi.hoisted(() => vi.fn());
const mockGetBotRuntimeStatus = vi.hoisted(() => vi.fn());
const mockUpdateBotRuntimeStatus = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/bot/sleep', () => ({ getBotSleepState: mockGetBotSleepState }));
vi.mock('./runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: { sleeping: 'sleeping' },
  getBotRuntimeStatus: mockGetBotRuntimeStatus,
  updateBotRuntimeStatus: mockUpdateBotRuntimeStatus,
}));

const provider = {
  applicationId: 'app-1',
  id: 'bot-1',
  lastActiveAt: new Date('2026-10-01T00:00:00.000Z'),
  userId: 'user-1',
  workspaceId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBotRuntimeStatus.mockResolvedValue({ status: 'connected' });
  mockUpdateBotRuntimeStatus.mockResolvedValue({});
});

describe('isBotAsleep', () => {
  it('records the sleeping status with its reason', async () => {
    mockGetBotSleepState.mockResolvedValue({ asleep: true, message: 'Idle.', upgradable: true });

    await expect(isBotAsleep('discord', provider)).resolves.toBe(true);
    expect(mockGetBotSleepState).toHaveBeenCalledWith({
      applicationId: 'app-1',
      lastActiveAt: provider.lastActiveAt,
      platform: 'discord',
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
      applicationId: 'app-1',
      errorCode: 'idle_sleep_upgradable',
      errorMessage: 'Idle.',
      platform: 'discord',
      status: 'sleeping',
    });
  });

  it('does not rewrite a sleeping status that already says the same', async () => {
    mockGetBotSleepState.mockResolvedValue({ asleep: true, message: 'Idle.' });
    mockGetBotRuntimeStatus.mockResolvedValue({
      errorCode: 'idle_sleep',
      errorMessage: 'Idle.',
      status: 'sleeping',
    });

    await expect(isBotAsleep('discord', provider)).resolves.toBe(true);
    expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
  });

  it('rewrites a sleeping status once an upgrade no longer helps', async () => {
    mockGetBotSleepState.mockResolvedValue({ asleep: true, message: 'Idle.', upgradable: false });
    mockGetBotRuntimeStatus.mockResolvedValue({
      errorCode: 'idle_sleep_upgradable',
      errorMessage: 'Idle.',
      status: 'sleeping',
    });

    await expect(isBotAsleep('discord', provider)).resolves.toBe(true);
    expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'idle_sleep' }),
    );
  });

  it('keeps an awake bot as it is', async () => {
    mockGetBotSleepState.mockResolvedValue({ asleep: false });

    await expect(isBotAsleep('discord', provider)).resolves.toBe(false);
    expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
  });

  it('fails open when the sleep check errors', async () => {
    mockGetBotSleepState.mockRejectedValue(new Error('down'));

    await expect(isBotAsleep('discord', provider)).resolves.toBe(false);
  });

  it('still reports asleep when the status write fails', async () => {
    mockGetBotSleepState.mockResolvedValue({ asleep: true });
    mockUpdateBotRuntimeStatus.mockRejectedValue(new Error('redis down'));

    await expect(isBotAsleep('discord', provider)).resolves.toBe(true);
  });
});

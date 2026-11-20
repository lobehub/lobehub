import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDispatchPermissionMode } from './permissionMode';

const getUserPreference = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserPreference };
  }),
}));

const db = {} as any;

describe('resolveDispatchPermissionMode', () => {
  beforeEach(() => {
    getUserPreference.mockReset();
  });

  it('starts Claude Code in the topic mode when the lab is on', async () => {
    getUserPreference.mockResolvedValue({ lab: { enableBetterCodingExperience: true } });
    await expect(
      resolveDispatchPermissionMode(db, 'u', {
        heteroType: 'claude-code',
        topicMetadata: { heteroPermissionMode: 'plan' },
      }),
    ).resolves.toBe('plan');
    await expect(
      resolveDispatchPermissionMode(db, 'u', { heteroType: 'claude-code', topicMetadata: {} }),
    ).resolves.toBe('bypassPermissions');
  });

  it('sends no mode with the lab off, for other agents, or when the read fails', async () => {
    getUserPreference.mockResolvedValue({ lab: {} });
    await expect(
      resolveDispatchPermissionMode(db, 'u', {
        heteroType: 'claude-code',
        topicMetadata: { heteroPermissionMode: 'plan' },
      }),
    ).resolves.toBeUndefined();

    getUserPreference.mockResolvedValue({ lab: { enableBetterCodingExperience: true } });
    await expect(
      resolveDispatchPermissionMode(db, 'u', { heteroType: 'codex', topicMetadata: {} }),
    ).resolves.toBeUndefined();

    getUserPreference.mockRejectedValue(new Error('db down'));
    await expect(
      resolveDispatchPermissionMode(db, 'u', { heteroType: 'claude-code', topicMetadata: {} }),
    ).resolves.toBeUndefined();
  });
});

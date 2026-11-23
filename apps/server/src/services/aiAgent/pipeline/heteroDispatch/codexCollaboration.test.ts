import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forDeviceRuntime, resolveDispatchCollaborationMode } from './codexCollaboration';

const preference = vi.hoisted(() => ({ lab: {} as Record<string, boolean> }));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserPreference: vi.fn(async () => ({ lab: preference.lab })) };
  }),
}));

const resolve = (topicMetadata: Record<string, unknown> | undefined, heteroType = 'codex') =>
  resolveDispatchCollaborationMode({} as any, 'user-1', { heteroType, topicMetadata });

describe('resolveDispatchCollaborationMode', () => {
  beforeEach(() => {
    preference.lab = { enableBetterCodingExperience: true, enableCodexAppServer: true };
  });

  it('sends nothing for a topic that never turned Plan on, or another agent', async () => {
    await expect(resolve({})).resolves.toBeUndefined();
    await expect(resolve({ heteroPlanMode: true }, 'claude-code')).resolves.toBeUndefined();
  });

  it('sends the switch, off included, with both labs on', async () => {
    await expect(resolve({ heteroPlanMode: true })).resolves.toBe('plan');
    await expect(resolve({ heteroPlanMode: false })).resolves.toBe('default');
  });

  it('sends nothing with either lab off', async () => {
    for (const lab of [{ enableCodexAppServer: true }, { enableBetterCodingExperience: true }]) {
      preference.lab = lab;
      await expect(resolve({ heteroPlanMode: true })).resolves.toBeUndefined();
    }
  });
});

describe('forDeviceRuntime', () => {
  it('keeps the mode only for a native run on an lh that takes it', () => {
    expect(forDeviceRuntime('plan', { native: true, supportsCollaborationMode: true })).toBe(
      'plan',
    );
    // An older lh, or `codex exec`, never receives it.
    expect(
      forDeviceRuntime('plan', { native: true, supportsCollaborationMode: false }),
    ).toBeUndefined();
    expect(
      forDeviceRuntime('plan', { native: false, supportsCollaborationMode: true }),
    ).toBeUndefined();
  });
});

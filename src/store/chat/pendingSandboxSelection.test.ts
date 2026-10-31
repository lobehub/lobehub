import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingSandboxSelection,
  getPendingSandboxSelection,
  resolvePendingSandboxSelection,
  setPendingSandboxSelection,
  setSandboxDefaultSelection,
  subscribePendingSandboxSelection,
  toSandboxTopicMetadata,
} from './pendingSandboxSelection';

const mocks = vi.hoisted(() => ({
  cachedEntitlement: undefined as { entitled: boolean } | undefined,
  getEntitlement: vi.fn(),
}));

vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getEntitlement: mocks.getEntitlement },
}));

vi.mock('@/store/sandbox', () => ({
  sandboxSelectors: { entitlement: () => mocks.cachedEntitlement },
  useSandboxStore: { getState: () => ({}) },
}));

describe('pendingSandboxSelection', () => {
  it('notifies a subscriber on set and on consume — a second reader must move too', () => {
    // Two components read this: the switch that writes and the chip that only
    // reads. A Map cannot tell React it changed, so a write that told only its
    // own component left the chip on the old value.
    const listener = vi.fn();
    const unsubscribe = subscribePendingSandboxSelection(listener);

    setPendingSandboxSelection('agent-1', { mode: 'persistent' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPendingSandboxSelection('agent-1')).toEqual({ mode: 'persistent' });

    consumePendingSandboxSelection('agent-1');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getPendingSandboxSelection('agent-1')).toBeUndefined();

    unsubscribe();
    setPendingSandboxSelection('agent-1', { mode: 'ephemeral' });
    expect(listener).toHaveBeenCalledTimes(2);
    consumePendingSandboxSelection('agent-1');
  });

  it('returns a stable value between writes, as useSyncExternalStore requires', () => {
    setPendingSandboxSelection('agent-2', { instanceId: 'i', mode: 'persistent' });
    expect(getPendingSandboxSelection('agent-2')).toBe(getPendingSandboxSelection('agent-2'));
    consumePendingSandboxSelection('agent-2');
  });

  it('carries the environment into the new topic beside the folder it was picked with', () => {
    expect(
      toSandboxTopicMetadata({
        drive: 'personal',
        environmentId: 'env_1',
        mode: 'persistent',
        workingDirectory: 'app',
      }),
    ).toMatchObject({
      sandboxDrive: 'personal',
      sandboxEnvironmentId: 'env_1',
      sandboxWorkingDirectory: 'app',
    });
    expect(toSandboxTopicMetadata(undefined)).toBeUndefined();
  });

  // The entitlement loads after the composer does. A first message sent while
  // it is still in flight used to be born with no folder — the paid default
  // silently became a temporary sandbox.
  describe('resolvePendingSandboxSelection', () => {
    const root = { workingDirectory: '.' };

    beforeEach(() => {
      mocks.cachedEntitlement = undefined;
      mocks.getEntitlement.mockReset();
    });

    it('settles the default against the server when the entitlement has not loaded', async () => {
      mocks.getEntitlement.mockResolvedValue({ entitled: true });
      setSandboxDefaultSelection('agent-cold', root);

      await expect(resolvePendingSandboxSelection('agent-cold')).resolves.toEqual(root);
      // It becomes the pick, so the transport reading it next sees the same.
      expect(getPendingSandboxSelection('agent-cold')).toEqual(root);

      consumePendingSandboxSelection('agent-cold');
      setSandboxDefaultSelection('agent-cold');
    });

    it('leaves a plan without a drive on the temporary sandbox', async () => {
      mocks.getEntitlement.mockResolvedValue({ entitled: false });
      setSandboxDefaultSelection('agent-free', root);

      await expect(resolvePendingSandboxSelection('agent-free')).resolves.toBeUndefined();
      expect(getPendingSandboxSelection('agent-free')).toBeUndefined();

      setSandboxDefaultSelection('agent-free');
    });

    it('uses the cached answer without asking the server again', async () => {
      mocks.cachedEntitlement = { entitled: true };
      setSandboxDefaultSelection('agent-warm', root);

      await expect(resolvePendingSandboxSelection('agent-warm')).resolves.toEqual(root);
      expect(mocks.getEntitlement).not.toHaveBeenCalled();

      consumePendingSandboxSelection('agent-warm');
      setSandboxDefaultSelection('agent-warm');
    });

    it('keeps an explicit pick, including the temporary sandbox', async () => {
      mocks.cachedEntitlement = { entitled: true };
      setSandboxDefaultSelection('agent-picked', root);
      setPendingSandboxSelection('agent-picked', {});

      await expect(resolvePendingSandboxSelection('agent-picked')).resolves.toEqual({});

      consumePendingSandboxSelection('agent-picked');
      setSandboxDefaultSelection('agent-picked');
    });

    it('reads a failed lookup, or an agent without a default, as no drive', async () => {
      mocks.getEntitlement.mockRejectedValue(new Error('offline'));
      setSandboxDefaultSelection('agent-offline', root);

      await expect(resolvePendingSandboxSelection('agent-offline')).resolves.toBeUndefined();
      await expect(resolvePendingSandboxSelection('agent-none')).resolves.toBeUndefined();

      setSandboxDefaultSelection('agent-offline');
    });
  });
});

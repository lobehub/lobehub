import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingSandboxSelection,
  getPendingSandboxSelection,
  resolvePendingSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';

import { useSeedDefaultSelection } from './useSeedDefaultSelection';

const getEntitlement = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getEntitlement },
}));

vi.mock('@/store/sandbox', () => ({
  sandboxSelectors: { entitlement: () => undefined },
  useSandboxStore: { getState: () => ({}) },
}));

const AGENT = 'agent-seed';

afterEach(() => {
  consumePendingSandboxSelection(AGENT);
  getEntitlement.mockReset();
});

describe('useSeedDefaultSelection', () => {
  it('fills the empty slot once the plan is known to include a drive', () => {
    renderHook(() =>
      useSeedDefaultSelection(AGENT, { eligible: true, entitled: true, hasTopic: false }),
    );

    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: '.' });
  });

  it('never overwrites a pick, including the temporary sandbox', () => {
    setPendingSandboxSelection(AGENT, {});

    renderHook(() =>
      useSeedDefaultSelection(AGENT, { eligible: true, entitled: true, hasTopic: false }),
    );

    expect(getPendingSandboxSelection(AGENT)).toEqual({});
  });

  // The default registered while the entitlement loads must not outlive the
  // sandbox surface: a run moved to a machine would otherwise wait on the
  // entitlement at its first send and be born with a sandbox folder.
  it('withdraws the registered default when the surface unmounts', async () => {
    getEntitlement.mockResolvedValue({ entitled: true });
    const { unmount } = renderHook(() =>
      useSeedDefaultSelection(AGENT, { eligible: true, entitled: false, hasTopic: false }),
    );

    unmount();

    await expect(resolvePendingSandboxSelection(AGENT)).resolves.toBeUndefined();
    expect(getEntitlement).not.toHaveBeenCalled();
  });

  it('keeps the default registered while the surface stays mounted', async () => {
    getEntitlement.mockResolvedValue({ entitled: true });
    renderHook(() =>
      useSeedDefaultSelection(AGENT, { eligible: true, entitled: false, hasTopic: false }),
    );

    await expect(resolvePendingSandboxSelection(AGENT)).resolves.toEqual({
      workingDirectory: '.',
    });
  });
});

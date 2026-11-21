import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingSandboxSelection,
  getPendingSandboxSelection,
  resolvePendingSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';

import { rememberSandboxSelection } from './rememberedSandboxDirectory';
import { useSeedDefaultSelection, useSeedTemporaryRepository } from './useSeedDefaultSelection';

const getEntitlement = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

const user = vi.hoisted(() => ({ id: 'user-a' as string | undefined }));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: object) => unknown) => selector({ user: { id: user.id } }),
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
  localStorage.clear();
  user.id = 'user-a';
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

  // T-14158: every new conversation went back to the drive's root.
  it('starts the next conversation in the folder the last one was put in', () => {
    const { rerender } = renderHook(
      ({ hasTopic }) =>
        useSeedDefaultSelection(AGENT, { eligible: true, entitled: true, hasTopic }),
      { initialProps: { hasTopic: false } },
    );
    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: '.' });

    // The first send consumes the slot; the person then moves the conversation.
    consumePendingSandboxSelection(AGENT);
    rerender({ hasTopic: true });
    rememberSandboxSelection({ userId: 'user-a' }, AGENT, { workingDirectory: 'projects/demo' });

    // A new conversation opens.
    rerender({ hasTopic: false });
    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: 'projects/demo' });
  });

  it('registers the remembered folder for a send made before the entitlement loads', async () => {
    getEntitlement.mockResolvedValue({ entitled: true });
    rememberSandboxSelection({ userId: 'user-a' }, AGENT, { workingDirectory: 'projects/demo' });

    renderHook(() =>
      useSeedDefaultSelection(AGENT, { eligible: true, entitled: false, hasTopic: false }),
    );

    await expect(resolvePendingSandboxSelection(AGENT)).resolves.toEqual({
      workingDirectory: 'projects/demo',
    });
  });

  // On a cold boot the persisted entitlement can be ready before the user id;
  // the root seeded meanwhile must give way once the remembered folder is readable.
  it('replaces the provisional root once the user id arrives', () => {
    rememberSandboxSelection({ userId: 'user-a' }, AGENT, { workingDirectory: 'projects/demo' });
    user.id = undefined;
    const { rerender } = renderHook(() =>
      useSeedDefaultSelection(AGENT, { eligible: true, entitled: true, hasTopic: false }),
    );
    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: '.' });

    user.id = 'user-a';
    rerender();

    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: 'projects/demo' });
  });
});

describe('useSeedTemporaryRepository — the first-send default', () => {
  const pane = (hasTopic: boolean, environmentId: string) => ({
    eligible: true,
    hasTopic,
    project: { environmentId },
    temporary: true,
  });

  it("registers a project draft's environment for its first send", async () => {
    renderHook(() => useSeedTemporaryRepository(AGENT, pane(false, 'env-project')));
    consumePendingSandboxSelection(AGENT);

    await expect(resolvePendingSandboxSelection(AGENT)).resolves.toEqual({
      environmentId: 'env-project',
    });
  });

  // The entry is the agent's: a split pane already on another project's topic
  // handed its environment to this pane's first send, or cleared it on unmount.
  it("is neither replaced nor cleared by another pane's existing topic", async () => {
    renderHook(() => useSeedTemporaryRepository(AGENT, pane(false, 'env-project')));
    const topicPane = renderHook(() => useSeedTemporaryRepository(AGENT, pane(true, 'env-other')));
    consumePendingSandboxSelection(AGENT);

    await expect(resolvePendingSandboxSelection(AGENT)).resolves.toEqual({
      environmentId: 'env-project',
    });

    consumePendingSandboxSelection(AGENT);
    topicPane.unmount();
    await expect(resolvePendingSandboxSelection(AGENT)).resolves.toEqual({
      environmentId: 'env-project',
    });
  });
});

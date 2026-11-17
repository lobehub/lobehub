import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getRememberedSandboxRepository,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';
import {
  prefersTemporarySandbox,
  TEMPORARY_SANDBOX_PREFERENCE_KEY,
} from './temporarySandboxPreference';
import { temporarySelection, useSandboxModeSelect } from './useSandboxModeSelect';
import type { SandboxSelection } from './useSandboxPlacement';

const state = vi.hoisted(() => ({
  driveStatus: 'ready' as 'hidden' | 'loading' | 'ready' | 'upgrade',
  seedPendingSandboxSelection: vi.fn(),
  selection: {} as Record<string, unknown>,
  setSelection: vi.fn(),
  topicId: undefined as string | undefined,
  workspaceId: null as string | null,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => state.workspaceId,
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: object) => unknown) => selector({ user: { id: 'user-1' } }),
}));
vi.mock('@/store/chat/pendingSandboxSelection', () => ({
  seedPendingSandboxSelection: state.seedPendingSandboxSelection,
}));
vi.mock('./useSandboxStorageAccess', () => ({
  useSandboxDriveStatus: () => state.driveStatus,
}));
vi.mock('./useSandboxPlacement', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSandboxPlacement: () => ({
    selection: state.selection,
    setSelection: state.setSelection,
    topicId: state.topicId,
  }),
}));

const ME = { userId: 'user-1', workspaceId: null };

const renderMode = () =>
  renderHook(() =>
    useSandboxModeSelect('agent-1', { enabled: true, topicId: state.topicId ?? null }),
  );

beforeEach(() => {
  localStorage.clear();
  state.driveStatus = 'ready';
  state.selection = {};
  state.topicId = undefined;
  state.workspaceId = null;
  state.seedPendingSandboxSelection.mockReset();
  state.setSelection.mockReset().mockResolvedValue(undefined);
});

describe('temporarySelection', () => {
  it('drops the folder and keeps the repository it starts from', () => {
    expect(temporarySelection({ workingDirectory: 'notes' })).toEqual({});
    expect(
      temporarySelection({ environmentId: 'env-1', workingDirectory: '.lobe/projects/p/env-1' }),
    ).toEqual({ environmentId: 'env-1' });
  });
});

describe('useSandboxModeSelect', () => {
  it('reads a drive folder as the persistent sandbox, only with a drive', () => {
    state.selection = { workingDirectory: 'notes' };
    expect(renderMode().result.current.persistent).toBe(true);

    state.driveStatus = 'upgrade';
    expect(renderMode().result.current.persistent).toBe(false);

    state.driveStatus = 'ready';
    state.selection = {};
    expect(renderMode().result.current.persistent).toBe(false);
  });

  it('moves an open conversation off the drive and remembers the pick', async () => {
    state.topicId = 'topic-1';
    state.selection = { workingDirectory: 'notes' };

    const { result } = renderMode();
    await act(() => result.current.toTemporary());

    expect(state.setSelection).toHaveBeenCalledWith({});
    expect(prefersTemporarySandbox(ME, 'agent-1')).toBe(true);
  });

  it('puts an open conversation on the default drive folder', async () => {
    state.topicId = 'topic-1';
    state.workspaceId = 'ws_1';
    localStorage.setItem(
      TEMPORARY_SANDBOX_PREFERENCE_KEY,
      JSON.stringify({ 'user-1:ws_1:agent-1': true }),
    );

    const { result } = renderMode();
    await act(() => result.current.toPersistent());

    expect(state.setSelection).toHaveBeenCalledWith({ drive: 'personal', workingDirectory: '.' });
    expect(prefersTemporarySandbox({ ...ME, workspaceId: 'ws_1' }, 'agent-1')).toBe(false);
  });

  it('keeps the folder a conversation already works in', async () => {
    state.topicId = 'topic-1';
    state.selection = { workingDirectory: 'notes' } satisfies SandboxSelection;

    const { result } = renderMode();
    await act(() => result.current.toPersistent());

    expect(state.setSelection).not.toHaveBeenCalled();
  });

  // Seeded rather than picked: a project conversation still takes its checkout.
  it('gives a conversation not started yet the default as a default', async () => {
    const { result } = renderMode();
    await act(() => result.current.toPersistent());

    expect(state.setSelection).not.toHaveBeenCalled();
    expect(state.seedPendingSandboxSelection).toHaveBeenCalledWith('agent-1', {
      workingDirectory: '.',
    });
  });

  // T-14158: switching back to the persistent sandbox starts in the folder the
  // agent's last conversation used, like a new conversation does.
  it('gives a conversation back the remembered folder', async () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'projects/demo' });

    const { result } = renderMode();
    await act(() => result.current.toPersistent());

    expect(state.seedPendingSandboxSelection).toHaveBeenCalledWith('agent-1', {
      workingDirectory: 'projects/demo',
    });
  });

  // Leaving the drive, a conversation starts from the repository the agent's
  // last temporary sandbox used.
  it('moves a conversation off the drive onto the remembered repository', async () => {
    state.topicId = 'topic-1';
    state.selection = { workingDirectory: 'notes' } satisfies SandboxSelection;
    rememberSandboxSelection(ME, 'agent-1', { environmentId: 'env_repo' });

    const { result } = renderMode();
    await act(() => result.current.toTemporary());

    expect(state.setSelection).toHaveBeenCalledWith({ environmentId: 'env_repo' });
  });

  it('remembers the repository a conversation leaves the drive with', async () => {
    state.topicId = 'topic-1';
    state.selection = {
      environmentId: 'env_old',
      workingDirectory: 'notes',
    } satisfies SandboxSelection;

    const { result } = renderMode();
    await act(() => result.current.toTemporary());

    expect(state.setSelection).toHaveBeenCalledWith({ environmentId: 'env_old' });
    expect(getRememberedSandboxRepository(ME, 'agent-1')).toEqual({ environmentId: 'env_old' });
  });

  it('remembers nothing without a drive service', async () => {
    state.driveStatus = 'hidden';

    const { result } = renderMode();
    await act(() => result.current.toTemporary());

    expect(prefersTemporarySandbox(ME, 'agent-1')).toBe(false);
    expect(state.setSelection).not.toHaveBeenCalled();
  });

  // A failed move leaves the conversation where it was, so new ones must not
  // start in the other mode either.
  it('keeps the preference when moving the conversation fails', async () => {
    state.topicId = 'topic-1';
    state.selection = { workingDirectory: 'notes' };
    state.setSelection.mockRejectedValue(new Error('offline'));

    const { result } = renderMode();
    await expect(act(() => result.current.toTemporary())).rejects.toThrow('offline');
    expect(prefersTemporarySandbox(ME, 'agent-1')).toBe(false);

    state.selection = {};
    localStorage.setItem(
      TEMPORARY_SANDBOX_PREFERENCE_KEY,
      JSON.stringify({ 'user-1:personal:agent-1': true }),
    );
    const { result: again } = renderMode();
    await expect(act(() => again.current.toPersistent())).rejects.toThrow('offline');
    expect(prefersTemporarySandbox(ME, 'agent-1')).toBe(true);
  });

  // Not yet known is not "no drive": the pick still has to take the
  // conversation off the drive, or it flips back once the answer arrives.
  it('moves the conversation off the drive while the entitlement loads', async () => {
    state.driveStatus = 'loading';
    state.topicId = 'topic-1';
    state.selection = { workingDirectory: 'notes' };

    const { result } = renderMode();
    expect(result.current.persistent).toBe(true);
    await act(() => result.current.toTemporary());

    expect(state.setSelection).toHaveBeenCalledWith({});
    expect(prefersTemporarySandbox(ME, 'agent-1')).toBe(true);
  });
});

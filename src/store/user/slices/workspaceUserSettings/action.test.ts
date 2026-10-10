import type { WorkspaceUserPreference } from '@lobechat/types';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceUserSettingsService } from '@/services/workspaceUserSettings';
import { useUserStore } from '@/store/user';

const active = vi.hoisted(() => ({ id: 'workspace-1' as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => active.id,
  useActiveWorkspaceId: () => active.id,
}));

vi.mock('@/services/workspaceUserSettings', () => ({
  workspaceUserSettingsService: {
    getPreference: vi.fn(),
    updatePreference: vi.fn(),
  },
}));

const state = () => useUserStore.getState();

/** Seed the active workspace's bucket as if the replica had already loaded it. */
const seed = (preference: WorkspaceUserPreference) =>
  useUserStore.setState({
    workspaceUserPreference: preference,
    workspaceUserPreferenceWorkspaceId: 'workspace-1',
  });

describe('WorkspaceUserSettingsActionImpl', () => {
  beforeEach(() => {
    active.id = 'workspace-1';
    vi.clearAllMocks();
    vi.mocked(workspaceUserSettingsService.updatePreference).mockResolvedValue(undefined);
    useUserStore.setState({
      workspaceUserPreference: {},
      workspaceUserPreferenceWorkspaceId: null,
    });
  });

  it('optimistically deep-merges one Agent model choice without dropping other choices', async () => {
    seed({
      agentDeviceOverrides: { deviceAgent: { executionTarget: 'sandbox' as const } },
      agentModelOverrides: { existing: { model: 'existing-model', provider: 'existing-provider' } },
      agentModeOverrides: { existing: true },
    });

    await act(() =>
      state().updateWorkspaceUserPreference({
        agentModelOverrides: {
          selected: { model: 'selected-model', provider: 'selected-provider' },
        },
      }),
    );

    expect(state().workspaceUserPreference).toEqual({
      agentDeviceOverrides: { deviceAgent: { executionTarget: 'sandbox' } },
      agentModelOverrides: {
        existing: { model: 'existing-model', provider: 'existing-provider' },
        selected: { model: 'selected-model', provider: 'selected-provider' },
      },
      agentModeOverrides: { existing: true },
    });
    expect(workspaceUserSettingsService.updatePreference).toHaveBeenCalledWith({
      agentModelOverrides: {
        selected: { model: 'selected-model', provider: 'selected-provider' },
      },
    });
  });

  it('optimistically deep-merges one Agent mode without dropping other modes', async () => {
    seed({ agentModeOverrides: { existing: true } });

    await act(() =>
      state().updateWorkspaceUserPreference({ agentModeOverrides: { selected: false } }),
    );

    expect(state().workspaceUserPreference.agentModeOverrides).toEqual({
      existing: true,
      selected: false,
    });
  });

  it('optimistically deep-merges one Agent device override without dropping others', async () => {
    seed({ agentDeviceOverrides: { keep: { executionTarget: 'local' } } });

    await act(() =>
      state().updateWorkspaceUserPreference({
        agentDeviceOverrides: { selected: { executionTarget: 'sandbox' as const } },
      }),
    );

    expect(state().workspaceUserPreference.agentDeviceOverrides).toEqual({
      keep: { executionTarget: 'local' },
      selected: { executionTarget: 'sandbox' },
    });
  });

  it('optimistically deep-merges sidebar visibility without dropping other items', async () => {
    seed({ sidebarAgentVisibilityOverrides: { existing: true } });

    await act(() =>
      state().updateWorkspaceUserPreference({
        sidebarAgentVisibilityOverrides: { selected: false },
      }),
    );

    expect(state().workspaceUserPreference.sidebarAgentVisibilityOverrides).toEqual({
      existing: true,
      selected: false,
    });
  });

  it('optimistically deep-merges one notification switch without dropping sibling toggles', async () => {
    seed({
      notification: {
        email: { items: { workspace: { workspace_member_joined: false } } },
        inbox: { enabled: false },
      },
    });

    // Patch a single other leaf — the earlier email item toggle and the inbox
    // master switch must both survive in the optimistic view, mirroring what
    // the server-side deep merge keeps in the DB.
    await act(() =>
      state().updateWorkspaceUserPreference({
        notification: {
          email: { items: { workspace: { workspace_payment_failed: false } } },
        },
      }),
    );

    expect(state().workspaceUserPreference.notification).toEqual({
      email: {
        items: {
          workspace: { workspace_member_joined: false, workspace_payment_failed: false },
        },
      },
      inbox: { enabled: false },
    });
  });

  it('rolls the view back when the mutation fails', async () => {
    seed({ agentModeOverrides: { existing: true } });
    vi.mocked(workspaceUserSettingsService.updatePreference).mockRejectedValue(new Error('boom'));

    await act(async () => {
      await expect(
        state().updateWorkspaceUserPreference({ agentModeOverrides: { selected: false } }),
      ).rejects.toThrow('boom');
    });

    expect(state().workspaceUserPreference).toEqual({ agentModeOverrides: { existing: true } });
  });

  it('keeps the pre-migration server call in personal mode (no active workspace)', async () => {
    active.id = null;
    seed({ agentModeOverrides: { existing: true } });

    await act(() =>
      state().updateWorkspaceUserPreference({ agentModeOverrides: { selected: false } }),
    );

    expect(workspaceUserSettingsService.updatePreference).toHaveBeenCalledWith({
      agentModeOverrides: { selected: false },
    });
    // No workspace key to write under — the view is untouched.
    expect(state().workspaceUserPreference).toEqual({ agentModeOverrides: { existing: true } });
  });
});

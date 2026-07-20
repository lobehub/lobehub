import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceUserSettingsService } from '@/services/workspaceUserSettings';

import { WorkspaceUserSettingsActionImpl } from './action';

const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => 'workspace-1',
  useActiveWorkspaceId: () => 'workspace-1',
}));

vi.mock('@/libs/swr', () => ({
  mutate: mockMutate,
  useClientDataSWR: vi.fn(),
}));

describe('WorkspaceUserSettingsActionImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('optimistically deep-merges one Agent model choice without dropping other choices', async () => {
    const state = {
      workspaceUserPreference: {
        agentDeviceOverrides: {
          deviceAgent: { executionTarget: 'sandbox' as const },
        },
        agentModelOverrides: {
          existing: { model: 'existing-model', provider: 'existing-provider' },
        },
      },
    };
    const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
    const action = new WorkspaceUserSettingsActionImpl(set as never, () => state as never);
    vi.spyOn(workspaceUserSettingsService, 'updatePreference').mockResolvedValue();

    await action.updateWorkspaceUserPreference({
      agentModelOverrides: {
        selected: { model: 'selected-model', provider: 'selected-provider' },
      },
    });

    expect(state.workspaceUserPreference).toEqual({
      agentDeviceOverrides: {
        deviceAgent: { executionTarget: 'sandbox' },
      },
      agentModelOverrides: {
        existing: { model: 'existing-model', provider: 'existing-provider' },
        selected: { model: 'selected-model', provider: 'selected-provider' },
      },
    });
    expect(mockMutate).toHaveBeenCalledWith(
      ['FETCH_WORKSPACE_USER_SETTINGS', 'workspace-1'],
      state.workspaceUserPreference,
      { revalidate: false },
    );
  });
});

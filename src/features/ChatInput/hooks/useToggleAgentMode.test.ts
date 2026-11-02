import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToggleAgentMode } from './useToggleAgentMode';

const testState = vi.hoisted(() => ({
  access: {
    canManageAgent: false,
    isAccessLoading: false,
  },
  agent: {
    current: undefined as { visibility?: 'private' | 'public'; workspaceId?: string } | undefined,
  },
  businessCanEnable: true,
  updateAgentChatConfig: vi.fn(),
  updateWorkspaceUserPreference: vi.fn(),
}));

vi.mock('@/business/client/hooks/useBusinessAgentMode', () => ({
  useBusinessCanEnableAgentMode: () => testState.businessCanEnable,
}));

vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => testState.access,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof testState.agent) => unknown) => selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentById: () => (s: typeof testState.agent) => s.current,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (
    selector: (s: {
      updateWorkspaceUserPreference: typeof testState.updateWorkspaceUserPreference;
    }) => unknown,
  ) => selector({ updateWorkspaceUserPreference: testState.updateWorkspaceUserPreference }),
}));

vi.mock('./useAgentId', () => ({
  useAgentId: () => 'agent-1',
}));

vi.mock('./useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentChatConfig: testState.updateAgentChatConfig }),
}));

describe('useToggleAgentMode', () => {
  beforeEach(() => {
    testState.access.canManageAgent = false;
    testState.access.isAccessLoading = false;
    testState.agent.current = undefined;
    testState.businessCanEnable = true;
    testState.updateAgentChatConfig = vi.fn();
    testState.updateWorkspaceUserPreference = vi.fn();
  });

  it('stores a public Workspace member mode as a personal preference', async () => {
    testState.agent.current = { visibility: 'public', workspaceId: 'workspace-1' };
    const { result } = renderHook(() => useToggleAgentMode());

    await act(() => result.current('chat'));

    expect(testState.updateWorkspaceUserPreference).toHaveBeenCalledWith({
      agentContextModeOverrides: { 'agent-1': 'default' },
      agentModeOverrides: { 'agent-1': false },
    });
    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();
  });

  it('updates the shared default for the author or Workspace admin', async () => {
    testState.access.canManageAgent = true;
    testState.agent.current = { visibility: 'public', workspaceId: 'workspace-1' };
    const { result } = renderHook(() => useToggleAgentMode());

    await act(() => result.current('agent'));

    expect(testState.updateAgentChatConfig).toHaveBeenCalledWith({
      contextMode: 'default',
      enableAgentMode: true,
      promptMode: 'full',
    });
    expect(testState.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });

  it('persists on-demand only when the user explicitly selects the third mode', async () => {
    const { result } = renderHook(() => useToggleAgentMode());

    await act(() => result.current('on-demand'));

    expect(testState.updateAgentChatConfig).toHaveBeenCalledWith({
      contextMode: 'on-demand',
      enableAgentMode: true,
      promptMode: 'full',
    });
  });

  it('stores on-demand as a per-Agent Workspace member preference', async () => {
    testState.agent.current = { visibility: 'public', workspaceId: 'workspace-1' };
    const { result } = renderHook(() => useToggleAgentMode());

    await act(() => result.current('on-demand'));

    expect(testState.updateWorkspaceUserPreference).toHaveBeenCalledWith({
      agentContextModeOverrides: { 'agent-1': 'on-demand' },
      agentModeOverrides: { 'agent-1': true },
    });
    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();
  });

  it('downgrades to the legacy default when business policy disables Agent mode', async () => {
    testState.businessCanEnable = false;
    const { result } = renderHook(() => useToggleAgentMode());

    await act(() => result.current('on-demand'));

    expect(testState.updateAgentChatConfig).toHaveBeenCalledWith({
      contextMode: 'default',
      enableAgentMode: false,
      promptMode: 'full',
    });
  });

  it('does not write while management access is unresolved', async () => {
    testState.access.isAccessLoading = true;
    testState.agent.current = { visibility: 'public', workspaceId: 'workspace-1' };
    const { result } = renderHook(() => useToggleAgentMode());

    await act(() => result.current('agent'));

    expect(testState.updateAgentChatConfig).not.toHaveBeenCalled();
    expect(testState.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });
});

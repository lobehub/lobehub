import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClaudeCodeMemory } from './useClaudeCodeMemory';

const mocks = vi.hoisted(() => ({
  agentEnv: {} as Record<string, Record<string, string> | undefined>,
  isDesktop: true,
  listMemory: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return mocks.isDesktop;
  },
}));
vi.mock('@/services/claudeCodeMemory', () => ({
  claudeCodeMemoryService: { listMemory: mocks.listMemory },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: (agentId: string) => () => ({
      heterogeneousProvider: { env: mocks.agentEnv[agentId], type: 'claude-code' },
    }),
  },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

const memoryDir = '/home/me/.claude/projects/-repo/memory';

describe('useClaudeCodeMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentEnv = {};
    mocks.isDesktop = true;
  });

  it('reads the project memory over the local desktop transport', async () => {
    mocks.listMemory.mockResolvedValue({ files: [], memoryDir });

    const { result } = renderHook(() => useClaudeCodeMemory({ workingDirectory: '/repo' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual({ files: [], memoryDir }));
    expect(mocks.listMemory).toHaveBeenCalledWith({
      agentId: undefined,
      deviceId: undefined,
      env: { CLAUDE_CODE_PROJECT_DIR_NAME: undefined, CLAUDE_CONFIG_DIR: undefined },
      workingDirectory: '/repo',
    });
  });

  it("follows the agent's own Claude Code config dir, as its runs do", async () => {
    mocks.agentEnv['agent-1'] = { CLAUDE_CONFIG_DIR: '/home/me/.claude-work', OTHER: 'x' };
    mocks.listMemory.mockResolvedValue({ files: [], memoryDir });

    const { result } = renderHook(
      () => useClaudeCodeMemory({ agentId: 'agent-1', workingDirectory: '/repo' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocks.listMemory).toHaveBeenCalledWith({
      agentId: 'agent-1',
      deviceId: undefined,
      env: { CLAUDE_CODE_PROJECT_DIR_NAME: undefined, CLAUDE_CONFIG_DIR: '/home/me/.claude-work' },
      workingDirectory: '/repo',
    });
  });

  it('stays inert without a project folder, or on web without a bound device', () => {
    renderHook(() => useClaudeCodeMemory({}), { wrapper });
    mocks.isDesktop = false;
    renderHook(() => useClaudeCodeMemory({ workingDirectory: '/repo' }), { wrapper });

    expect(mocks.listMemory).not.toHaveBeenCalled();
  });

  it('reports an offline device as an error, not as an empty memory', async () => {
    mocks.listMemory.mockResolvedValue(null);

    const { result } = renderHook(
      () =>
        useClaudeCodeMemory({
          agentId: 'agent-1',
          deviceId: 'device-1',
          workingDirectory: '/repo',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.requiresUpgrade).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mocks.listMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        deviceId: 'device-1',
        workingDirectory: '/repo',
      }),
    );
  });

  it.each([
    'Unknown device RPC method: listClaudeCodeMemory',
    "Error invoking remote method 'workspace.listClaudeCodeMemory': Error: No handler registered for 'workspace.listClaudeCodeMemory'",
  ])('requests an upgrade for a missing memory method: %s', async (message) => {
    mocks.listMemory.mockRejectedValue(new Error(message));
    const { result } = renderHook(() => useClaudeCodeMemory({ workingDirectory: '/repo' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.requiresUpgrade).toBe(true));
    expect(result.current.data).toBeUndefined();

    // Reconnect after upgrading and reload the same panel, without remounting it.
    mocks.listMemory.mockResolvedValue({ files: [], memoryDir });
    await act(async () => {
      await result.current.mutate();
    });
    expect(result.current.requiresUpgrade).toBe(false);
    expect(result.current.data).toEqual({ files: [], memoryDir });
  });

  it.each([
    'Device RPC timed out',
    'EACCES: permission denied',
    'Unknown device RPC method: listProjectSkills',
  ])('keeps unrelated failures retryable: %s', async (message) => {
    mocks.listMemory.mockRejectedValue(new Error(message));
    const { result } = renderHook(() => useClaudeCodeMemory({ workingDirectory: '/repo' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.requiresUpgrade).toBe(false);
  });
});

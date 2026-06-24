/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { useSkillConnect } from './useSkillConnect';

const mocks = vi.hoisted(() => {
  const toolState = {
    checkLobehubSkillStatus: vi.fn(),
    composioServers: [] as Array<{ identifier: string; status: string }>,
    createComposioConnection: vi.fn(),
    getLobehubSkillAuthorizeUrl: vi.fn(),
    lobehubSkillServers: [] as Array<{
      identifier: string;
      isConnected: boolean;
      name: string;
      status: string;
    }>,
    refreshComposioConnectionStatus: vi.fn(),
    removeComposioConnection: vi.fn(),
    revokeLobehubSkill: vi.fn(),
  };

  const useToolStore = Object.assign(
    vi.fn(<T>(selector: (state: typeof toolState) => T): T => selector(toolState)),
    {
      getState: vi.fn(() => toolState),
    },
  );

  return {
    toolState,
    useToolStore,
    userState: { userId: 'user-id' },
  };
});

vi.mock('@/store/tool', () => ({
  useToolStore: mocks.useToolStore,
}));

vi.mock('@/store/tool/selectors', () => ({
  composioStoreSelectors: {
    getServerByIdentifier:
      (identifier: string) =>
      (
        state: typeof mocks.toolState,
      ): (typeof mocks.toolState.composioServers)[number] | undefined =>
        state.composioServers.find((server) => server.identifier === identifier),
  },
  lobehubSkillStoreSelectors: {
    getServerByIdentifier:
      (identifier: string) =>
      (
        state: typeof mocks.toolState,
      ): (typeof mocks.toolState.lobehubSkillServers)[number] | undefined =>
        state.lobehubSkillServers.find((server) => server.identifier === identifier),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: <T>(selector: (state: typeof mocks.userState) => T): T => selector(mocks.userState),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: typeof mocks.userState) => state.userId,
  },
}));

describe('useSkillConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toolState.composioServers = [];
    mocks.toolState.lobehubSkillServers = [];
  });

  it('keeps a LobeHub connector selected when revoke does not change its connected status', async () => {
    mocks.toolState.lobehubSkillServers = [
      {
        identifier: 'notion',
        isConnected: true,
        name: 'Notion',
        status: LobehubSkillStatus.CONNECTED,
      },
    ];
    mocks.toolState.revokeLobehubSkill.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSkillConnect({ identifier: 'notion', type: 'lobehub' }));

    let disconnected = true;
    await act(async () => {
      disconnected = await result.current.handleDisconnect();
    });

    expect(mocks.toolState.revokeLobehubSkill).toHaveBeenCalledWith('notion');
    expect(disconnected).toBe(false);
  });

  it('reports a LobeHub connector as disconnected after revoke updates the latest store state', async () => {
    mocks.toolState.lobehubSkillServers = [
      {
        identifier: 'notion',
        isConnected: true,
        name: 'Notion',
        status: LobehubSkillStatus.CONNECTED,
      },
    ];
    mocks.toolState.revokeLobehubSkill.mockImplementation(async () => {
      mocks.toolState.lobehubSkillServers[0].status = LobehubSkillStatus.NOT_CONNECTED;
      mocks.toolState.lobehubSkillServers[0].isConnected = false;
    });

    const { result } = renderHook(() => useSkillConnect({ identifier: 'notion', type: 'lobehub' }));

    let disconnected = false;
    await act(async () => {
      disconnected = await result.current.handleDisconnect();
    });

    expect(disconnected).toBe(true);
  });

  it('keeps a Composio connector selected when removal leaves the latest account active', async () => {
    mocks.toolState.composioServers = [
      {
        identifier: 'slack',
        status: ComposioServerStatus.ACTIVE,
      },
    ];
    mocks.toolState.removeComposioConnection.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSkillConnect({ identifier: 'slack', type: 'composio' }));

    let disconnected = true;
    await act(async () => {
      disconnected = await result.current.handleDisconnect();
    });

    expect(mocks.toolState.removeComposioConnection).toHaveBeenCalledWith('slack');
    expect(disconnected).toBe(false);
  });

  it('reports a Composio connector as disconnected once the active account is gone', async () => {
    mocks.toolState.composioServers = [
      {
        identifier: 'slack',
        status: ComposioServerStatus.ACTIVE,
      },
    ];
    mocks.toolState.removeComposioConnection.mockImplementation(async () => {
      mocks.toolState.composioServers = [];
    });

    const { result } = renderHook(() => useSkillConnect({ identifier: 'slack', type: 'composio' }));

    let disconnected = false;
    await act(async () => {
      disconnected = await result.current.handleDisconnect();
    });

    expect(disconnected).toBe(true);
  });
});

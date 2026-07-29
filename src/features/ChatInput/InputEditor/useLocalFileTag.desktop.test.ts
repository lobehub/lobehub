import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalFileTag } from './useLocalFileTag.desktop';

const { agentState, chatState, electronState, searchProjectFilesMock } = vi.hoisted(() => ({
  agentState: {
    agencyConfig: undefined as
      | {
          boundDeviceId?: string;
          executionTarget?: 'device' | 'local';
          heterogeneousProvider?: { type: string };
        }
      | undefined,
    isLocalSystemEnabled: true,
    workingDirectory: '/local/repo',
  },
  chatState: {
    topicWorkingDirectory: undefined as string | undefined,
  },
  electronState: {
    currentDeviceId: 'local-device',
  },
  searchProjectFilesMock: vi.fn(),
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    searchProjectFiles: searchProjectFilesMock,
  },
}));

vi.mock('../hooks/useAgentId', () => ({
  useAgentId: () => 'agent-1',
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: <T>(selector: (state: typeof agentState) => T) => selector(agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => (state: typeof agentState) => state.agencyConfig,
    getAgentWorkingDirectoryById: () => (state: typeof agentState) => state.workingDirectory,
  },
  chatConfigByIdSelectors: {
    isLocalSystemEnabledById: () => (state: typeof agentState) => state.isLocalSystemEnabled,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: <T>(selector: (state: typeof chatState) => T) => selector(chatState),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentTopicWorkingDirectory: (state: typeof chatState) => state.topicWorkingDirectory,
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: <T>(selector: (state: { gatewayDeviceInfo?: { deviceId: string } }) => T) =>
    selector({ gatewayDeviceInfo: { deviceId: electronState.currentDeviceId } }),
}));

vi.mock('./MentionMenu/LocalFileIcon', () => ({
  default: () => null,
}));

describe('useLocalFileTag.desktop', () => {
  beforeEach(() => {
    agentState.agencyConfig = undefined;
    agentState.isLocalSystemEnabled = true;
    agentState.workingDirectory = '/local/repo';
    chatState.topicWorkingDirectory = undefined;
    electronState.currentDeviceId = 'local-device';
    searchProjectFilesMock.mockReset();
    searchProjectFilesMock.mockResolvedValue({
      entries: [],
      root: '/local/repo',
      searchedAt: '2026-07-01T00:00:00.000Z',
      source: 'git',
    });
  });

  it('does not pass the local gateway device id for local desktop file search', async () => {
    const { result } = renderHook(() => useLocalFileTag());

    await result.current.searchLocalFiles('button');

    expect(searchProjectFilesMock).toHaveBeenCalledWith({
      deviceId: undefined,
      limit: 20,
      query: 'button',
      scope: '/local/repo',
    });
  });

  it('adds the relative directory tail to the menu description slot', async () => {
    searchProjectFilesMock.mockResolvedValueOnce({
      entries: [
        {
          isDirectory: false,
          name: 'README.md',
          path: '/local/repo/packages/editor/README.md',
          relativePath: 'packages/editor/README.md',
        },
      ],
      root: '/local/repo',
      searchedAt: '2026-07-01T00:00:00.000Z',
      source: 'git',
    });

    const { result } = renderHook(() => useLocalFileTag());

    const items = await result.current.searchLocalFiles('readme');

    expect(items[0]).toMatchObject({
      key: 'local-file-/local/repo/packages/editor/README.md',
      label: 'README.md',
      metadata: {
        description: 'packages/editor/',
        name: 'README.md',
        path: '/local/repo/packages/editor/README.md',
        relativePath: 'packages/editor/README.md',
        type: 'localFile',
      },
    });
  });

  it('passes a remote bound device id for remote file search', async () => {
    agentState.agencyConfig = {
      boundDeviceId: 'remote-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };
    agentState.workingDirectory = '/remote/repo';

    const { result } = renderHook(() => useLocalFileTag());

    await result.current.searchLocalFiles('button');

    expect(searchProjectFilesMock).toHaveBeenCalledWith({
      deviceId: 'remote-device',
      limit: 20,
      query: 'button',
      scope: '/remote/repo',
    });
  });
});

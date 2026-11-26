import type * as LobeConst from '@lobechat/const';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  currentDeviceId: 'device-local',
  directories: [] as { deviceId?: string; id: string; path: string; projectId: string }[],
  pending: undefined as { agentId: string; projectWorkingDirectoryId: string } | undefined,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeConst>()),
  isDesktop: true,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ pendingNewTopicDirectory: state.pending }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: unknown) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: state.currentDeviceId } }),
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: () => state.directories,
  useProjectDirectoryStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchDirectories: () => ({}) }),
}));

const { useStagedFilesDirectory } = await import('../useStagedFilesDirectory');

beforeEach(() => {
  state.pending = { agentId: 'agt_1', projectWorkingDirectoryId: 'dir_1' };
  state.directories = [
    { deviceId: 'device-local', id: 'dir_1', path: '/repo', projectId: 'prj_1' },
  ];
});

describe('useStagedFilesDirectory', () => {
  it('should read a directory on this desktop locally', () => {
    const { result } = renderHook(() => useStagedFilesDirectory('agt_1', undefined));

    expect(result.current).toEqual({ deviceId: undefined, directory: '/repo' });
  });

  it('should read a directory on another device through that device', () => {
    state.directories = [{ deviceId: 'device-2', id: 'dir_1', path: '/repo', projectId: 'prj_1' }];

    const { result } = renderHook(() => useStagedFilesDirectory('agt_1', undefined));

    expect(result.current).toEqual({ deviceId: 'device-2', directory: '/repo' });
  });

  it('should ignore the staging once the conversation has a topic', () => {
    const { result } = renderHook(() => useStagedFilesDirectory('agt_1', 'tpc_1'));

    expect(result.current).toBeUndefined();
  });

  it('should ignore a draft staged for another agent', () => {
    const { result } = renderHook(() => useStagedFilesDirectory('agt_2', undefined));

    expect(result.current).toBeUndefined();
  });
});

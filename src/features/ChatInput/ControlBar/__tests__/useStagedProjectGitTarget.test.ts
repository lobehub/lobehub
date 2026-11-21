import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStagedProjectGitTarget } from '../useStagedProjectGitTarget';

const testState = vi.hoisted(() => ({
  currentDeviceId: undefined as string | undefined,
  directories: [] as { deviceId: string | null; id: string; path: string }[],
  directoryId: undefined as string | undefined,
  isDesktop: false,
  repoType: 'git' as 'git' | 'github' | undefined,
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: { gatewayDeviceInfo?: { deviceId?: string } }) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: testState.currentDeviceId } }),
}));

vi.mock('../useProjectTopicDirectory', () => ({
  useStagedProjectDirectory: () => ({
    directories: testState.directories,
    directoryId: testState.directoryId,
  }),
}));

vi.mock('../useRepoType', () => ({ useRepoType: () => testState.repoType }));

describe('useStagedProjectGitTarget', () => {
  beforeEach(() => {
    testState.currentDeviceId = undefined;
    testState.directories = [
      { deviceId: 'other', id: 'dir-0', path: '/Users/me/other' },
      { deviceId: 'm4-pro', id: 'dir-1', path: '/Users/me/repo' },
    ];
    testState.directoryId = 'dir-1';
    testState.isDesktop = false;
    testState.repoType = 'git';
  });

  it('reads the staged directory on its own device', () => {
    const { result } = renderHook(() => useStagedProjectGitTarget('agent-1'));

    expect(result.current).toEqual({ deviceId: 'm4-pro', isGithub: false, path: '/Users/me/repo' });
  });

  it('probes this desktop locally when the directory lives here', () => {
    testState.isDesktop = true;
    testState.currentDeviceId = 'm4-pro';
    testState.repoType = 'github';

    const { result } = renderHook(() => useStagedProjectGitTarget('agent-1'));

    expect(result.current).toEqual({ deviceId: undefined, isGithub: true, path: '/Users/me/repo' });
  });

  it('still targets a directory whose repo type no picker cache recorded', () => {
    // A directory bound in Project Settings on a remote device never enters that
    // device's picker cache; the branch probe decides whether it is a repo.
    testState.repoType = undefined;

    const { result } = renderHook(() => useStagedProjectGitTarget('agent-1'));

    expect(result.current).toEqual({ deviceId: 'm4-pro', isGithub: false, path: '/Users/me/repo' });
  });

  it('has no target when nothing is staged', () => {
    testState.directoryId = undefined;

    const { result } = renderHook(() => useStagedProjectGitTarget('agent-1'));

    expect(result.current).toBeUndefined();
  });
});

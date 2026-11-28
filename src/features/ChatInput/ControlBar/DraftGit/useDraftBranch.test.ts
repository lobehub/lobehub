import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { draftBranchKey, getDraftGitTarget, useDraftGitStore } from './draftGitStore';
import { useDraftBranch } from './useDraftBranch';

const base = {
  agentId: 'agent-1',
  currentBranch: 'main',
  isGithub: true,
  path: '/code/lobehub',
  sourcePath: '/code/lobehub',
};

beforeEach(() => {
  useDraftGitStore.setState({ selections: {}, targets: {} });
  useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'this-mac' } } as any);
});

describe('useDraftBranch', () => {
  it('defaults the pick to HEAD and records another branch without checking out', () => {
    const { result } = renderHook(() => useDraftBranch({ ...base, enabled: true }));
    expect(result.current.selectedBranch).toBe('main');

    act(() => result.current.select('feat'));
    expect(result.current.selectedBranch).toBe('feat');

    // Picking HEAD's branch again clears the pick, so the draft follows HEAD.
    act(() => result.current.select('main'));
    expect(useDraftGitStore.getState().selections).toEqual({});
  });

  it('registers the directory under the real device id, also for this machine', () => {
    const { unmount } = renderHook(() => useDraftBranch({ ...base, enabled: true }));
    expect(getDraftGitTarget('agent-1')).toMatchObject({
      deviceId: undefined,
      keyDeviceId: 'this-mac',
      path: '/code/lobehub',
    });

    unmount();
    expect(getDraftGitTarget('agent-1')).toBeUndefined();
  });

  it('keeps picks per device and directory apart', () => {
    const { result, rerender } = renderHook((props) => useDraftBranch(props), {
      initialProps: { ...base, enabled: true },
    });
    act(() => result.current.select('feat'));

    rerender({ ...base, enabled: true, path: '/code/other', sourcePath: '/code/other' });
    expect(result.current.selectedBranch).toBe('main');
    expect(
      useDraftGitStore.getState().selections[
        draftBranchKey({ agentId: 'agent-1', keyDeviceId: 'this-mac', path: '/code/lobehub' })
      ],
    ).toBe('feat');
  });

  it('registers nothing for an existing topic', () => {
    renderHook(() => useDraftBranch({ ...base, enabled: false }));
    expect(getDraftGitTarget('agent-1')).toBeUndefined();
  });
});

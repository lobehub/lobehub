import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

describe('openCanvas', () => {
  beforeEach(() => {
    useGlobalStore.setState({ isStatusInit: true });
  });

  it('opens an existing canvas as a working sidebar tab', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.clearPortalStack();
      result.current.openCanvas('cvs_1', 2);
    });

    expect(result.current.showPortal).toBe(false);
    expect(result.current.canvasTabVersions).toEqual({ cvs_1: 2 });
    expect(useGlobalStore.getState().status.showRightPanel).toBe(true);
    expect(useGlobalStore.getState().status.workingSidebarTab).toBe('canvas:cvs_1');
  });

  it('follows the latest version again when reopened without one', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.openCanvas('cvs_1', 2);
      result.current.openCanvas('cvs_2', 1);
      result.current.openCanvas('cvs_1');
    });

    expect(result.current.canvasTabVersions).toEqual({ cvs_2: 1 });
    expect(useGlobalStore.getState().status.workingSidebarTab).toBe('canvas:cvs_1');
  });
});

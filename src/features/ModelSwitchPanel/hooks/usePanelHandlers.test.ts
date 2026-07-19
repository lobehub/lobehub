/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePanelHandlers } from './usePanelHandlers';

const { updateAgentConfigMock, usePermissionMock } = vi.hoisted(() => ({
  updateAgentConfigMock: vi.fn(),
  usePermissionMock: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: usePermissionMock,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (
    selector: (state: { updateAgentConfig: typeof updateAgentConfigMock }) => unknown,
  ) => selector({ updateAgentConfig: updateAgentConfigMock }),
}));

describe('usePanelHandlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateAgentConfigMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers the store update until the close animation window elapses', () => {
    const { result } = renderHook(() => usePanelHandlers({}));

    act(() => {
      result.current.handleModelChange('gpt-5', 'openai');
    });
    expect(updateAgentConfigMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(updateAgentConfigMock).toHaveBeenCalledWith({ model: 'gpt-5', provider: 'openai' });
  });

  it('does not fire the deferred update after unmount', () => {
    const { result, unmount } = renderHook(() => usePanelHandlers({}));

    act(() => {
      result.current.handleModelChange('gpt-5', 'openai');
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(updateAgentConfigMock).not.toHaveBeenCalled();
  });

  it('only keeps the latest pending model change', () => {
    const { result } = renderHook(() => usePanelHandlers({}));

    act(() => {
      result.current.handleModelChange('a', 'openai');
      result.current.handleModelChange('b', 'anthropic');
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(updateAgentConfigMock).toHaveBeenCalledTimes(1);
    expect(updateAgentConfigMock).toHaveBeenCalledWith({ model: 'b', provider: 'anthropic' });
  });
});

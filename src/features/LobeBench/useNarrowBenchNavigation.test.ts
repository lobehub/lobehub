import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNarrowBenchNavigation } from './useNarrowBenchNavigation';

const viewport = vi.hoisted(() => ({ md: true }));
const location = vi.hoisted(() => ({ key: 'first' }));
const state = vi.hoisted(() => ({
  isStatusInit: true,
  status: { showLeftPanel: true },
  toggleLeftPanel: vi.fn(),
}));
vi.mock('@lobehub/ui', () => ({ useResponsive: () => viewport }));
vi.mock('react-router', () => ({ useLocation: () => location }));
vi.mock('@/store/global', () => ({
  useGlobalStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}));

describe('useNarrowBenchNavigation', () => {
  beforeEach(() => {
    viewport.md = true;
    location.key = 'first';
    state.isStatusInit = true;
    state.status.showLeftPanel = true;
    state.toggleLeftPanel.mockReset().mockImplementation((value: boolean) => {
      state.status.showLeftPanel = value;
    });
  });

  it('collapses on narrow entry without overriding a manual reopen until navigation', () => {
    viewport.md = false;
    const { rerender } = renderHook(() => useNarrowBenchNavigation());
    expect(state.toggleLeftPanel).toHaveBeenCalledTimes(1);
    state.status.showLeftPanel = true;
    rerender();
    expect(state.toggleLeftPanel).toHaveBeenCalledTimes(1);
    location.key = 'next';
    rerender();
    expect(state.toggleLeftPanel).toHaveBeenCalledTimes(2);
    expect(state.status.showLeftPanel).toBe(false);
  });

  it('handles wide-to-narrow transitions and does not automatically reopen on wide', () => {
    const { rerender } = renderHook(() => useNarrowBenchNavigation());
    expect(state.toggleLeftPanel).not.toHaveBeenCalled();
    viewport.md = false;
    rerender();
    expect(state.status.showLeftPanel).toBe(false);
    viewport.md = true;
    rerender();
    expect(state.status.showLeftPanel).toBe(false);
    expect(state.toggleLeftPanel).toHaveBeenCalledTimes(1);
  });

  it('waits for persisted status hydration before applying the initial collapse', () => {
    viewport.md = false;
    state.isStatusInit = false;
    const { rerender } = renderHook(() => useNarrowBenchNavigation());
    expect(state.toggleLeftPanel).not.toHaveBeenCalled();
    state.isStatusInit = true;
    rerender();
    expect(state.toggleLeftPanel).toHaveBeenCalledWith(false);
  });
});

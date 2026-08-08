import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import { useReportPanelExpand } from './useReportPanelExpand';

const { mockUseResponsive } = vi.hoisted(() => ({ mockUseResponsive: vi.fn() }));

vi.mock('antd-style', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useResponsive: mockUseResponsive };
});

/** `lg` is false below 992px — the width where the list and the report stop fitting. */
const setViewport = (wide: boolean) => mockUseResponsive.mockReturnValue({ lg: wide });

const showPanel = () => useGlobalStore.getState().status.showVerifyReportPanel;

describe('useReportPanelExpand', () => {
  beforeEach(() => {
    // `updateSystemStatus` no-ops until the status slice is initialized, so writes
    // would silently vanish without this.
    useGlobalStore.setState({ isStatusInit: true });
    useGlobalStore.getState().updateSystemStatus({ showVerifyReportPanel: true });
  });

  it('follows the persisted preference on a wide viewport', () => {
    setViewport(true);
    const { result } = renderHook(() => useReportPanelExpand());

    expect(result.current).toMatchObject({ expand: true, isNarrow: false });

    act(() => result.current.setExpand(false));
    expect(result.current.expand).toBe(false);
    expect(showPanel()).toBe(false);
  });

  it('collapses on a narrow viewport even though the preference says expanded', () => {
    setViewport(false);
    const { result } = renderHook(() => useReportPanelExpand());

    expect(result.current).toMatchObject({ expand: false, isNarrow: true });
    // The preference itself is untouched — it still describes the wide layout.
    expect(showPanel()).toBe(true);
  });

  it('opens as a transient overlay on a narrow viewport without clobbering the preference', () => {
    setViewport(false);
    const { result } = renderHook(() => useReportPanelExpand());

    act(() => result.current.setExpand(true));
    expect(result.current.expand).toBe(true);
    expect(showPanel()).toBe(true);

    act(() => result.current.setExpand(false));
    expect(result.current.expand).toBe(false);
    // Collapsing the overlay must not write `false` into the wide-layout preference,
    // or resizing back would leave the panel gone with no explanation.
    expect(showPanel()).toBe(true);
  });

  it('restores the preferred layout when the viewport widens again', () => {
    setViewport(false);
    const { rerender, result } = renderHook(() => useReportPanelExpand());

    act(() => result.current.setExpand(true)); // overlay open while narrow
    setViewport(true);
    rerender();

    expect(result.current).toMatchObject({ expand: true, isNarrow: false });
    // ...and the overlay state is dropped, so it can't linger as a second source of
    // truth: collapsing now writes through to the preference.
    act(() => result.current.setExpand(false));
    expect(showPanel()).toBe(false);
  });
});

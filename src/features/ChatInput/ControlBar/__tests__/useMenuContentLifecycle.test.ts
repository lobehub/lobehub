import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMenuContentLifecycle } from '../useMenuContentLifecycle';

describe('useMenuContentLifecycle', () => {
  it('commits a selection only after the close animation completes', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMenuContentLifecycle(onSelect));

    act(() => result.current.handleOpenChange(true));

    expect(result.current.open).toBe(true);

    act(() => result.current.deferSelection('provider/model'));

    expect(result.current.open).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();

    act(() => result.current.handleOpenChangeComplete(true));
    expect(onSelect).not.toHaveBeenCalled();

    act(() => result.current.handleOpenChangeComplete(false));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('provider/model');

    act(() => result.current.handleOpenChangeComplete(false));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not select anything when the menu is dismissed', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMenuContentLifecycle(onSelect));

    act(() => result.current.handleOpenChange(true));
    act(() => result.current.handleOpenChange(false));
    act(() => result.current.handleOpenChangeComplete(false));

    expect(onSelect).not.toHaveBeenCalled();
  });
});

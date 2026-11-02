import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRefreshOnReturn } from './useRefreshOnReturn';

describe('useRefreshOnReturn', () => {
  it('does not refresh on first mount: the first fetch is already running', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(true, refresh));

    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes each time the panel is shown again', () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ active }) => useRefreshOnReturn(active, refresh), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    expect(refresh).not.toHaveBeenCalled();

    rerender({ active: true });
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    rerender({ active: false });
    rerender({ active: true });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

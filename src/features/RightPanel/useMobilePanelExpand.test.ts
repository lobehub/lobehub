import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMobilePanelExpand } from './useMobilePanelExpand';

describe('useMobilePanelExpand', () => {
  it('closes a persisted open panel when a mobile page mounts', () => {
    const onExpandChange = vi.fn();

    renderHook(() => useMobilePanelExpand(true, true, onExpandChange));

    expect(onExpandChange).toHaveBeenCalledWith(false);
  });

  it('leaves the desktop preference alone', () => {
    const onExpandChange = vi.fn();

    renderHook(() => useMobilePanelExpand(false, true, onExpandChange));

    expect(onExpandChange).not.toHaveBeenCalled();
  });

  it('does not fight the user once they open the panel on mobile', () => {
    const onExpandChange = vi.fn();
    const { rerender } = renderHook(
      ({ expand }) => useMobilePanelExpand(true, expand, onExpandChange),
      { initialProps: { expand: false } },
    );

    rerender({ expand: true });

    expect(onExpandChange).not.toHaveBeenCalled();
  });
});

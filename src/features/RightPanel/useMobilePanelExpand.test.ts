import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMobilePanelExpand } from './useMobilePanelExpand';

describe('useMobilePanelExpand', () => {
  it('closes a persisted open panel when a mobile page mounts', () => {
    const onExpandChange = vi.fn();

    renderHook(() => useMobilePanelExpand({ expand: true, mobile: true, onExpandChange }));

    expect(onExpandChange).toHaveBeenCalledWith(false);
  });

  it('keeps a panel that mounts open because the user just selected something', () => {
    const onExpandChange = vi.fn();

    renderHook(() =>
      useMobilePanelExpand({
        expand: true,
        expandFollowsSelection: true,
        mobile: true,
        onExpandChange,
      }),
    );

    expect(onExpandChange).not.toHaveBeenCalled();
  });

  it('leaves the desktop preference alone', () => {
    const onExpandChange = vi.fn();

    renderHook(() => useMobilePanelExpand({ expand: true, mobile: false, onExpandChange }));

    expect(onExpandChange).not.toHaveBeenCalled();
  });

  it('does not fight the user once they open the panel on mobile', () => {
    const onExpandChange = vi.fn();
    const { rerender } = renderHook(
      ({ expand }) => useMobilePanelExpand({ expand, mobile: true, onExpandChange }),
      { initialProps: { expand: false } },
    );

    rerender({ expand: true });

    expect(onExpandChange).not.toHaveBeenCalled();
  });
});

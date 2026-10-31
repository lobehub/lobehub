import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DETAIL_PANEL_DEFAULT_WIDTH, useDetailPanelWidth } from './useDetailPanelWidth';

describe('useDetailPanelWidth', () => {
  it('keeps the width the user resized the panel to', () => {
    const { result } = renderHook(() => useDetailPanelWidth());

    expect(result.current.width).toBe(DETAIL_PANEL_DEFAULT_WIDTH);

    act(() => {
      result.current.handleSizeChange({ width: 200 }, { height: '100%', width: 680 });
    });

    expect(result.current.width).toBe(680);
  });

  it('ignores size changes without a width', () => {
    const { result } = renderHook(() => useDetailPanelWidth());

    act(() => {
      result.current.handleSizeChange({}, { height: '100%' });
    });

    expect(result.current.width).toBe(DETAIL_PANEL_DEFAULT_WIDTH);
  });
});

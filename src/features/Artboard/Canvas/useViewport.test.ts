import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import type { BoardModel } from '../model';
import { artboardActions } from '../store';
import { useViewport } from './useViewport';

it('fits a focused item into the space beside an open phone outline', () => {
  const stage = document.createElement('div');
  const outline = document.createElement('nav');
  const viewport = document.createElement('div');
  stage.append(outline, viewport);
  outline.dataset.artboardOutline = '';
  Object.defineProperties(outline, { offsetLeft: { value: 12 }, offsetWidth: { value: 210 } });
  Object.defineProperties(viewport, { clientHeight: { value: 640 }, clientWidth: { value: 390 } });
  const rect = { h: 300, w: 500, x: 60, y: 20 };
  const board = {
    boardById: { item: { rect } },
    bounds: { maxX: 560, maxY: 320, minX: 60, minY: 20 },
    pageId: 'page',
  } as unknown as BoardModel;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  artboardActions.reset();
  artboardActions.setOutlineOpen(true);
  const ref = { current: viewport };
  const hook = renderHook(() => useViewport(ref, board, () => {}));
  try {
    act(() => artboardActions.focusItem('item'));
    const { k, x } = hook.result.current.view;
    const left = x + rect.x * k;
    const right = left + rect.w * k;
    expect(left).toBeGreaterThan(222);
    expect(right).toBeLessThan(390);
    expect(right - left).toBeGreaterThan(100);
  } finally {
    hook.unmount();
    artboardActions.reset();
    vi.unstubAllGlobals();
  }
});

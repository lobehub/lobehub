import { describe, expect, it, vi } from 'vitest';

import { getSelectedFlowNodeId, isRectVisible, panNodeIntoView } from './flowViewport';

const size = { height: 600, width: 1000 };

describe('isRectVisible', () => {
  it('accepts a rect inside the canvas at the current zoom', () => {
    expect(
      isRectVisible({ height: 100, width: 200, x: 100, y: 50 }, { x: 0, y: 0, zoom: 1 }, size),
    ).toBe(true);
  });

  it('accepts a rect the canvas edge merely clips', () => {
    expect(
      isRectVisible({ height: 100, width: 200, x: 900, y: 50 }, { x: 0, y: 0, zoom: 1 }, size),
    ).toBe(true);
  });

  it('rejects a rect pushed past the edge entirely', () => {
    expect(
      isRectVisible({ height: 100, width: 200, x: 1100, y: 50 }, { x: 0, y: 0, zoom: 1 }, size),
    ).toBe(false);
    expect(
      isRectVisible({ height: 100, width: 200, x: 500, y: 50 }, { x: -800, y: 0, zoom: 1 }, size),
    ).toBe(false);
  });
});

describe('panNodeIntoView', () => {
  const flow = (
    viewport = { x: 0, y: 0, zoom: 1 },
    bounds = { height: 100, width: 200, x: 100, y: 50 },
  ) => ({
    getNodesBounds: vi.fn().mockReturnValue(bounds),
    getViewport: vi.fn().mockReturnValue(viewport),
    setViewport: vi.fn(),
  });

  it('does nothing without a node, without a layout, or when it is fully visible', () => {
    const idle = flow();
    panNodeIntoView(idle, size, undefined);
    panNodeIntoView(idle, size, 'node-1');
    const unlaid = flow({ x: 0, y: 0, zoom: 1 }, { height: 0, width: 0, x: 0, y: 0 });
    panNodeIntoView(unlaid, size, 'node-1');
    expect(idle.setViewport).not.toHaveBeenCalled();
    expect(unlaid.setViewport).not.toHaveBeenCalled();
  });

  it('holds the canvas still for a node the narrower panel only clipped', () => {
    const api = flow({ x: 0, y: 0, zoom: 1 }, { height: 100, width: 200, x: 900, y: 50 });
    panNodeIntoView(api, size, 'node-1');
    expect(api.setViewport).not.toHaveBeenCalled();
  });

  it('rescues a node pushed off screen entirely, by the least distance', () => {
    // 1100..1300 against a 1000 canvas: 324px back, not a centring jump.
    const api = flow({ x: 0, y: 0, zoom: 1 }, { height: 100, width: 200, x: 1100, y: 50 });
    panNodeIntoView(api, size, 'node-1');
    expect(api.setViewport).toHaveBeenCalledWith({ x: -324, y: 0, zoom: 1 });
  });

  it('leaves the axis that still fits completely alone', () => {
    const api = flow({ x: 0, y: 0, zoom: 1 }, { height: 100, width: 200, x: -300, y: 200 });
    panNodeIntoView(api, size, 'node-1');
    expect(api.setViewport).toHaveBeenCalledWith({ x: 324, y: 0, zoom: 1 });
  });

  it('aligns the leading edge of a node too tall to fit', () => {
    const api = flow({ x: 0, y: 0, zoom: 1 }, { height: 900, width: 200, x: 100, y: 700 });
    panNodeIntoView(api, size, 'node-1');
    expect(api.setViewport).toHaveBeenCalledWith({ x: 0, y: -676, zoom: 1 });
  });

  it('scales the shift with the zoom', () => {
    const api = flow({ x: 0, y: 0, zoom: 0.5 }, { height: 100, width: 200, x: 2200, y: 50 });
    panNodeIntoView(api, size, 'node-1');
    expect(api.setViewport).toHaveBeenCalledWith({ x: -224, y: 0, zoom: 0.5 });
  });
});

describe('getSelectedFlowNodeId', () => {
  it('reads the picked node from graph data rather than the React Flow selected flag', () => {
    expect(
      getSelectedFlowNodeId([
        { data: { selected: false }, id: 'a' },
        { data: { selected: true }, id: 'b' },
        { data: {}, id: 'c' },
      ]),
    ).toBe('b');
    expect(getSelectedFlowNodeId([{ data: {}, id: 'a' }])).toBeUndefined();
  });
});

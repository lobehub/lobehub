/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { applyPendingOrder, isDropOutsideWindow, resolveSortableDrop } from './dropOutsideWindow';

const viewport = { height: 600, width: 800 };
const mouse = (clientX: number, clientY: number) =>
  new MouseEvent('mousedown', { clientX, clientY });

describe('isDropOutsideWindow', () => {
  it('is false for a drop inside the window', () => {
    expect(
      isDropOutsideWindow({ activatorEvent: mouse(100, 100), delta: { x: 50, y: 200 } }, viewport),
    ).toBe(false);
  });

  it('is true once the pointer travelled past an edge', () => {
    expect(
      isDropOutsideWindow({ activatorEvent: mouse(100, 100), delta: { x: 750, y: 0 } }, viewport),
    ).toBe(true);
    expect(
      isDropOutsideWindow({ activatorEvent: mouse(100, 100), delta: { x: -150, y: 0 } }, viewport),
    ).toBe(true);
  });

  it('never counts a keyboard drag', () => {
    expect(
      isDropOutsideWindow(
        { activatorEvent: new KeyboardEvent('keydown'), delta: { x: 9999, y: 0 } },
        viewport,
      ),
    ).toBe(false);
  });
});

describe('resolveSortableDrop', () => {
  const ids = ['a', 'b', 'c'];
  const drop = (over: string | null, delta = { x: 0, y: 40 }) => ({
    activatorEvent: mouse(100, 100),
    active: { id: 'a' },
    delta,
    over: over ? { id: over } : null,
  });

  it('reorders when dropped on another row', () => {
    expect(resolveSortableDrop(drop('c'), ids, viewport)).toEqual({
      ids: ['b', 'c', 'a'],
      type: 'reorder',
    });
  });

  it('opens a new window outside the window even when a row is reported as over', () => {
    expect(resolveSortableDrop(drop('b', { x: 900, y: 0 }), ids, viewport)).toEqual({
      id: 'a',
      type: 'openWindow',
    });
  });

  it('does nothing when dropped back in place', () => {
    expect(resolveSortableDrop(drop('a'), ids, viewport)).toEqual({ type: 'none' });
    expect(resolveSortableDrop(drop(null), ids, viewport)).toEqual({ type: 'none' });
  });
});

describe('applyPendingOrder', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('keeps the rows without a pending order', () => {
    expect(applyPendingOrder(rows, undefined)).toBe(rows);
  });

  it('shows the dropped order, keeping new rows after it and skipping gone ids', () => {
    expect(
      applyPendingOrder([...rows, { id: 'new' }], ['c', 'gone', 'a', 'b']).map((row) => row.id),
    ).toEqual(['c', 'a', 'b', 'new']);
  });
});

import { describe, expect, it } from 'vitest';

import { resolveDropTarget, rubberBand } from './tabDrag';
import { layoutStrip, type StripTab } from './tabLayout';

const flow = (...ids: string[]): StripTab[] => ids.map((id) => ({ id, pinned: false }));
const pinned = (...ids: string[]): StripTab[] => ids.map((id) => ({ id, pinned: true }));
const ids = (tabs: StripTab[]) => tabs.map((tab) => tab.id);
const pinnedIds = (tabs: StripTab[]) => tabs.filter((tab) => tab.pinned).map((tab) => tab.id);

const WIDE_STRIP = 1200;

describe('resolveDropTarget', () => {
  it('moves a tab to the slot nearest its centre within the flowing run', () => {
    const tabs = [...pinned('p'), ...flow('a', 'b', 'c')];

    const result = resolveDropTarget({
      activeId: 'a',
      draggedId: 'a',
      grabFraction: 0.5,
      pointerX: 551,
      stripWidth: WIDE_STRIP,
      tabs,
    });

    expect(ids(result)).toEqual(['p', 'b', 'c', 'a']);
    expect(pinnedIds(result)).toEqual(['p']);
  });

  it('reorders within the pinned run', () => {
    const tabs = [...pinned('p', 'q'), ...flow('a')];

    const result = resolveDropTarget({
      activeId: 'a',
      draggedId: 'q',
      grabFraction: 0.5,
      pointerX: 10,
      stripWidth: WIDE_STRIP,
      tabs,
    });

    expect(ids(result)).toEqual(['q', 'p', 'a']);
    expect(pinnedIds(result)).toEqual(['q', 'p']);
  });

  it('pins a flowing tab dragged left of the divider', () => {
    const tabs = [...pinned('p'), ...flow('a', 'b', 'c')];

    const result = resolveDropTarget({
      activeId: 'b',
      draggedId: 'b',
      grabFraction: 0.5,
      pointerX: 10,
      stripWidth: WIDE_STRIP,
      tabs,
    });

    expect(ids(result)).toEqual(['b', 'p', 'a', 'c']);
    expect(pinnedIds(result)).toEqual(['b', 'p']);
  });

  it('unpins a pinned tab dragged right of the divider', () => {
    const tabs = [...pinned('p'), ...flow('a', 'b', 'c')];

    const result = resolveDropTarget({
      activeId: 'p',
      draggedId: 'p',
      grabFraction: 0.5,
      pointerX: 300,
      stripWidth: WIDE_STRIP,
      tabs,
    });

    expect(ids(result)).toEqual(['a', 'p', 'b', 'c']);
    expect(pinnedIds(result)).toEqual([]);
  });

  it('keeps the current group while the pointer hovers on the divider', () => {
    const resolveAt = (tabs: StripTab[]) =>
      pinnedIds(
        resolveDropTarget({
          activeId: 'a',
          draggedId: 'a',
          grabFraction: 0.1,
          pointerX: 58,
          stripWidth: WIDE_STRIP,
          tabs,
        }),
      );

    expect(resolveAt([...pinned('p'), ...flow('a', 'b')])).toEqual(['p']);
    expect(resolveAt([...pinned('p', 'a'), ...flow('b')])).toEqual(['p', 'a']);
  });

  it('swaps the wider active tab once it passes a narrower neighbour', () => {
    const tabs = flow('a', 'b', 'c', 'd', 'e');
    const stripWidth = 540;
    const before = layoutStrip({ activeId: 'b', stripWidth, tabs }).placements;
    const active = before.find((placement) => placement.id === 'b')!;
    const next = before.find((placement) => placement.id === 'c')!;
    expect(active.width).toBeGreaterThan(next.width);

    const result = resolveDropTarget({
      activeId: 'b',
      draggedId: 'b',
      grabFraction: 0.5,
      pointerX: active.x + active.width / 2 + (next.width + 2) / 2 + 4,
      stripWidth,
      tabs,
    });

    expect(ids(result)).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('leaves tabs hidden in the overflow menu in their order', () => {
    const tabs = flow('t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9');
    const stripWidth = 400;
    const { hiddenCount } = layoutStrip({ activeId: 't0', stripWidth, tabs });
    expect(hiddenCount).toBeGreaterThan(0);
    const visibleCount = tabs.length - hiddenCount;

    const result = resolveDropTarget({
      activeId: 't0',
      draggedId: 't0',
      grabFraction: 0.5,
      pointerX: 2000,
      stripWidth,
      tabs,
    });

    expect(result[visibleCount - 1].id).toBe('t0');
    expect(ids(result.slice(visibleCount))).toEqual(ids(tabs.slice(visibleCount)));
  });
});

describe('rubberBand', () => {
  it('passes values inside the range through', () => {
    expect(rubberBand(50, 0, 100)).toBe(50);
  });

  it('resists overshoot and never exceeds the limit', () => {
    const slight = rubberBand(110, 0, 100);
    const far = rubberBand(10_000, 0, 100);

    expect(slight).toBeGreaterThan(100);
    expect(slight).toBeLessThan(110);
    expect(far).toBeLessThan(140);
    expect(rubberBand(-10, 0, 100)).toBeCloseTo(100 - slight, 5);
  });
});

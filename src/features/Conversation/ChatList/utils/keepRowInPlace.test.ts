import { describe, expect, it, vi } from 'vitest';

import type { VirtuaScrollMethods } from '../../store/slices/virtuaList/initialState';
import { keepRowInPlace } from './keepRowInPlace';

const ROW = 100;

const setup = (initialRows: string[], scrollOffset: number) => {
  let rows = initialRows;
  const scrollTo = vi.fn();
  const methods = {
    getItemOffset: (index: number) => index * ROW,
    getScrollOffset: () => scrollOffset,
    scrollTo,
  } as unknown as VirtuaScrollMethods;

  return {
    getRowIds: () => rows,
    getScrollMethods: () => methods,
    nextRender: async () => {},
    scrollTo,
    setRows: (next: string[]) => {
      rows = next;
    },
  };
};

describe('keepRowInPlace', () => {
  it('scrolls by the height of the rows inserted above the anchor', async () => {
    // The reader sees `m101` 50px below the viewport top.
    const list = setup(['older', 'gap', 'm101', 'm102'], 150);

    await keepRowInPlace({
      ...list,
      anchorId: 'm101',
      run: async () => list.setRows(['older', 'm1', 'm2', 'm3', 'm101', 'm102']),
    });

    // `m101` moved from row 2 to row 4: still 50px below the viewport top.
    expect(list.scrollTo).toHaveBeenCalledWith(350);
  });

  it('leaves the scroll alone when nothing moved or the anchor is gone', async () => {
    const list = setup(['gap', 'm101'], 0);

    await keepRowInPlace({ ...list, anchorId: 'm101', run: async () => {} });
    await keepRowInPlace({ ...list, anchorId: 'm101', run: async () => list.setRows(['m1']) });

    expect(list.scrollTo).not.toHaveBeenCalled();
  });
});

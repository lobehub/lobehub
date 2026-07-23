import { describe, expect, it } from 'vitest';

import {
  type DevDockItem,
  getDevDockItemsSnapshot,
  getItemComponent,
  registerDevDockItems,
} from './registry';

const panelItem = (id: string): DevDockItem => ({
  icon: (() => null) as never,
  id,
  load: async () => ({ default: () => null }),
  title: id,
  type: 'panel',
});

describe('DevDock registry', () => {
  it('registers items and exposes them in the snapshot', () => {
    registerDevDockItems([panelItem('a'), panelItem('b')]);

    const ids = getDevDockItemsSnapshot().map((item) => item.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('ignores duplicate ids on re-registration', () => {
    registerDevDockItems([panelItem('a'), panelItem('c')]);

    const ids = getDevDockItemsSnapshot().map((item) => item.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('keeps the snapshot reference stable when nothing changes', () => {
    const before = getDevDockItemsSnapshot();
    registerDevDockItems([panelItem('a')]);
    expect(getDevDockItemsSnapshot()).toBe(before);
  });

  it('caches lazy components per item id', () => {
    const item = panelItem('a');
    expect(getItemComponent(item)).toBe(getItemComponent(item));
  });
});

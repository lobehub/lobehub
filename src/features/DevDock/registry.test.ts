import { describe, expect, it } from 'vitest';

import {
  type DevDockItem,
  type DevDockPanelItem,
  type DevDockReadoutItem,
  getDevDockItemsSnapshot,
  getItemComponent,
  isItemPinned,
  registerDevDockItems,
  selectBarLayout,
} from './registry';

const icon = (() => null) as never;
const load = async () => ({ default: () => null });

const panelItem = (id: string, defaultPinned?: boolean): DevDockPanelItem => ({
  defaultPinned,
  icon,
  id,
  label: id,
  load,
  type: 'panel',
});

const readoutItem = (
  id: string,
  slot: 'center' | 'right',
  defaultPinned?: boolean,
): DevDockReadoutItem => ({
  defaultPinned,
  icon,
  id,
  label: id,
  load,
  slot,
  type: 'readout',
});

const actionItem = (id: string, defaultPinned?: boolean): DevDockItem => ({
  defaultPinned,
  icon,
  id,
  label: id,
  onTrigger: () => {},
  type: 'action',
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

describe('isItemPinned', () => {
  it('falls back to defaultPinned, then false', () => {
    expect(isItemPinned(panelItem('a', true), {})).toBe(true);
    expect(isItemPinned(panelItem('a', false), {})).toBe(false);
    expect(isItemPinned(panelItem('a'), {})).toBe(false);
  });

  it('override wins over defaultPinned in both directions', () => {
    expect(isItemPinned(panelItem('a', true), { a: false })).toBe(false);
    expect(isItemPinned(panelItem('a'), { a: true })).toBe(true);
  });

  it('ignores overrides of other ids', () => {
    expect(isItemPinned(panelItem('a', true), { b: false })).toBe(true);
  });
});

describe('selectBarLayout', () => {
  const items: DevDockItem[] = [
    panelItem('panel-pinned', true),
    panelItem('panel-hidden'),
    readoutItem('path', 'center', true),
    readoutItem('fps', 'right', true),
    readoutItem('memory', 'right'),
    actionItem('reload'),
    actionItem('devtools', true),
  ];

  it('splits pinned items into tabs / center / right', () => {
    const layout = selectBarLayout(items, {}, null);

    expect(layout.tabs.map((item) => item.id)).toEqual(['panel-pinned']);
    expect(layout.center?.id).toBe('path');
    expect(layout.right.map((item) => item.id)).toEqual(['fps', 'devtools']);
  });

  it('keeps a temporary tab for the active unpinned panel', () => {
    const layout = selectBarLayout(items, {}, 'panel-hidden');

    expect(layout.tabs.map((item) => item.id)).toEqual(['panel-pinned', 'panel-hidden']);
  });

  it('applies pin overrides to every zone', () => {
    const layout = selectBarLayout(
      items,
      { 'devtools': false, 'memory': true, 'panel-pinned': false, 'path': false },
      null,
    );

    expect(layout.tabs).toEqual([]);
    expect(layout.center).toBeUndefined();
    expect(layout.right.map((item) => item.id)).toEqual(['fps', 'memory']);
  });

  it('never places a center readout in the right cluster', () => {
    const layout = selectBarLayout(items, { fps: false }, null);

    expect(layout.right.map((item) => item.id)).toEqual(['devtools']);
  });
});

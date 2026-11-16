import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SortType } from '@/types/files';

import { useSortDropdown } from './useSortDropdown';

type SorterKey = 'custom' | 'name' | 'createdAt' | 'size';

const store = vi.hoisted(() => ({
  libraryId: undefined as string | undefined,
  sorter: 'createdAt' as SorterKey,
  sortType: 'desc' as SortType,
  setSorter: vi.fn(),
  setSortType: vi.fn(),
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

const setStore = (sorter: SorterKey, sortType: SortType, libraryId?: string) => {
  store.sorter = sorter;
  store.sortType = sortType;
  store.libraryId = libraryId;
};

const clickItem = (dropdown: ReturnType<typeof useSortDropdown>, key: string) => {
  const item = dropdown.menuItems
    .flatMap((group) => (group.type === 'group' ? group.children : []))
    .find((item) => item.key === key);
  if (!item) throw new Error(`Missing sort item: ${key}`);
  act(() => item.onClick());
};

describe('useSortDropdown', () => {
  beforeEach(() => {
    setStore('createdAt', SortType.Desc);
    store.setSorter.mockReset();
    store.setSortType.mockReset();
  });

  it('lists Custom Order first inside a library', () => {
    setStore('custom', SortType.Asc, 'kb-1');
    const { result } = renderHook(useSortDropdown);

    expect(result.current.menuItems).toMatchObject([
      {
        children: [
          { checked: true, key: 'custom', label: 'FileManager.sort.custom' },
          { checked: false, key: 'name', label: 'FileManager.sort.name' },
          { checked: false, key: 'createdAt', label: 'FileManager.sort.dateAdded' },
          { checked: false, key: 'size', label: 'FileManager.sort.size' },
        ],
        label: 'FileManager.sort.by',
        type: 'group',
      },
      { type: 'divider' },
      {
        children: [
          { checked: true, key: 'asc', label: 'FileManager.sort.asc' },
          { checked: false, key: 'desc', label: 'FileManager.sort.desc' },
        ],
        label: 'FileManager.sort.direction',
        type: 'group',
      },
    ]);
  });

  it('offers name, date and size outside a library', () => {
    const { result } = renderHook(useSortDropdown);
    const fields = result.current.menuItems[0];

    expect(fields.type).toBe('group');
    if (fields.type !== 'group') throw new Error('Missing sort fields');
    expect(fields.children.map((item) => item.key)).toEqual(['name', 'createdAt', 'size']);
  });

  it('defaults Name to ascending when it is not the active field', () => {
    const { result } = renderHook(useSortDropdown);
    clickItem(result.current, 'name');

    expect(store.setSorter).toHaveBeenCalledWith('name');
    expect(store.setSortType).toHaveBeenCalledWith(SortType.Asc);
  });

  it.each(['name', 'createdAt', 'size', 'custom'] as const)(
    'preserves direction when reselecting %s',
    (key) => {
      for (const direction of [SortType.Asc, SortType.Desc]) {
        setStore(key, direction, 'kb-1');
        store.setSorter.mockClear();
        store.setSortType.mockClear();
        const { result, unmount } = renderHook(useSortDropdown);
        clickItem(result.current, key);

        expect(store.setSorter).not.toHaveBeenCalled();
        expect(store.setSortType).not.toHaveBeenCalled();
        unmount();
      }
    },
  );

  it.each(['createdAt', 'size'] as const)('defaults %s to descending on first click', (key) => {
    setStore('name', SortType.Asc);
    const { result } = renderHook(useSortDropdown);
    clickItem(result.current, key);

    expect(store.setSorter).toHaveBeenCalledWith(key);
    expect(store.setSortType).toHaveBeenCalledWith(SortType.Desc);
  });

  it('defaults Custom Order to ascending when switching fields', () => {
    setStore('name', SortType.Desc, 'kb-1');
    const { result } = renderHook(useSortDropdown);
    clickItem(result.current, 'custom');

    expect(store.setSorter).toHaveBeenCalledWith('custom');
    expect(store.setSortType).toHaveBeenCalledWith(SortType.Asc);
  });

  it.each([SortType.Asc, SortType.Desc])('exposes the %s direction callback', (direction) => {
    const { result } = renderHook(useSortDropdown);

    clickItem(result.current, direction);

    expect(store.setSorter).not.toHaveBeenCalled();
    expect(store.setSortType).toHaveBeenCalledWith(direction);
  });

  it.each([
    ['size', 'FileManager.sort.size'],
    ['custom', 'FileManager.sort.custom'],
  ] as const)('reflects the active %s field and direction in the trigger', (key, label) => {
    setStore(key, SortType.Asc, 'kb-1');
    const { result, rerender } = renderHook(useSortDropdown);

    expect(result.current.currentSortLabel).toBe(`${label} · FileManager.sort.asc`);

    store.sortType = SortType.Desc;
    rerender();

    expect(result.current.currentSortLabel).toBe(`${label} · FileManager.sort.desc`);
  });

  it('preserves the fallback label when Custom Order is unavailable', () => {
    setStore('custom', SortType.Asc);
    const { result } = renderHook(useSortDropdown);

    expect(result.current.currentSortLabel).toBe(
      'FileManager.sort.dateAdded · FileManager.sort.asc',
    );
  });
});

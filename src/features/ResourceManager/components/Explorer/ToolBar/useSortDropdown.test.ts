import { act, renderHook } from '@testing-library/react';
import { ArrowDownAZ, CalendarIcon, GripVertical, HardDriveIcon } from 'lucide-react';
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
  const item = dropdown.menuItems.find((item) => item.key === key);
  if (!item || item.type === 'divider') throw new Error(`Missing sort item: ${key}`);
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

    expect(result.current.menuItems.map((item) => item.key)).toEqual([
      'custom',
      'name',
      'createdAt',
      'size',
      'sort-direction-divider',
      'asc',
      'desc',
    ]);
    expect(result.current.menuItems.slice(0, 4)).toMatchObject([
      { checked: true, icon: GripVertical, label: 'FileManager.sort.custom' },
      { checked: false, icon: ArrowDownAZ, label: 'FileManager.sort.name' },
      { checked: false, icon: CalendarIcon, label: 'FileManager.sort.dateAdded' },
      { checked: false, icon: HardDriveIcon, label: 'FileManager.sort.size' },
    ]);
  });

  it('hides Custom Order outside a library', () => {
    const { result } = renderHook(useSortDropdown);

    expect(result.current.menuItems.map((item) => item.key)).toEqual([
      'name',
      'createdAt',
      'size',
      'sort-direction-divider',
      'asc',
      'desc',
    ]);
  });

  it('defaults Name to ascending when it is not the active field', () => {
    const { result } = renderHook(useSortDropdown);
    clickItem(result.current, 'name');

    expect(store.setSorter).toHaveBeenCalledWith('name');
    expect(store.setSortType).toHaveBeenCalledWith(SortType.Asc);
  });

  it.each([
    [SortType.Desc, SortType.Asc],
    [SortType.Asc, SortType.Desc],
  ])('toggles the active field from %s to %s', (initial, expected) => {
    setStore('name', initial);
    const { result } = renderHook(useSortDropdown);
    clickItem(result.current, 'name');

    expect(store.setSorter).not.toHaveBeenCalled();
    expect(store.setSortType).toHaveBeenCalledWith(expected);
  });

  it.each(['createdAt', 'size'] as const)('defaults %s to descending on first click', (key) => {
    setStore('name', SortType.Asc);
    const { result } = renderHook(useSortDropdown);
    clickItem(result.current, key);

    expect(store.setSorter).toHaveBeenCalledWith(key);
    expect(store.setSortType).toHaveBeenCalledWith(SortType.Desc);
  });

  it.each(['name', 'custom'] as const)('resets Custom Order to ascending from %s', (key) => {
    setStore(key, SortType.Desc, 'kb-1');
    const { result } = renderHook(useSortDropdown);
    clickItem(result.current, 'custom');

    expect(store.setSorter).toHaveBeenCalledWith('custom');
    expect(store.setSortType).toHaveBeenCalledWith(SortType.Asc);
  });

  it.each([SortType.Asc, SortType.Desc])('exposes the %s direction callback', (direction) => {
    const { result } = renderHook(useSortDropdown);

    expect(result.current.menuItems.slice(-3)).toMatchObject([
      { key: 'sort-direction-divider', type: 'divider' },
      { checked: false, key: 'asc', label: 'FileManager.sort.asc' },
      { checked: true, key: 'desc', label: 'FileManager.sort.desc' },
    ]);
    clickItem(result.current, direction);

    expect(store.setSorter).not.toHaveBeenCalled();
    expect(store.setSortType).toHaveBeenCalledWith(direction);
  });

  it.each([
    ['size', HardDriveIcon, 'FileManager.sort.size'],
    ['custom', GripVertical, 'FileManager.sort.custom'],
  ] as const)('reflects the active %s field and direction in the trigger', (key, icon, label) => {
    setStore(key, SortType.Asc, 'kb-1');
    const { result, rerender } = renderHook(useSortDropdown);

    expect(result.current.currentSortIcon).toBe(icon);
    expect(result.current.currentSortLabel).toBe(`${label} · FileManager.sort.asc`);

    store.sortType = SortType.Desc;
    rerender();

    expect(result.current.currentSortLabel).toBe(`${label} · FileManager.sort.desc`);
  });

  it('preserves the fallback label and icon when Custom Order is unavailable', () => {
    setStore('custom', SortType.Asc);
    const { result } = renderHook(useSortDropdown);

    expect(result.current.currentSortIcon).toBe(ArrowDownAZ);
    expect(result.current.currentSortLabel).toBe(
      'FileManager.sort.dateAdded · FileManager.sort.asc',
    );
  });
});

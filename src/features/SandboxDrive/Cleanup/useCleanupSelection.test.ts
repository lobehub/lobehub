import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StorageAnalysisResult } from './analysis';
import { useCleanupSelection } from './useCleanupSelection';

const result: StorageAnalysisResult = {
  categories: [],
  items: [
    {
      bytes: 500,
      category: 'dependencies',
      isDirectory: true,
      path: 'app/node_modules',
      regenerable: true,
    },
    { bytes: 200, category: 'cache', isDirectory: true, path: 'app/.next', regenerable: true },
    { bytes: 300, category: 'other', isDirectory: false, path: 'app/data.bin', regenerable: false },
    {
      bytes: 50,
      category: 'environments',
      environment: 'e1',
      isDirectory: true,
      path: '.sandbox/envs/e1',
      regenerable: false,
    },
  ],
  largestDirectories: [],
  largestFiles: [],
  totalBytes: 1050,
};

describe('useCleanupSelection', () => {
  it('should select a whole category and add up what it frees', () => {
    const { result: hook } = renderHook(() => useCleanupSelection(result));

    act(() => hook.current.toggle(result.items.slice(0, 2), true));

    expect(hook.current.chosen.map((item) => item.path)).toEqual(['app/node_modules', 'app/.next']);
    expect(hook.current.bytes).toBe(700);
    expect(hook.current.regenerable).toBe(true);
  });

  it('should say a selection with anything irreplaceable is not regenerable', () => {
    const { result: hook } = renderHook(() => useCleanupSelection(result));

    act(() => hook.current.toggle([result.items[0], result.items[2]], true));

    expect(hook.current.regenerable).toBe(false);
  });

  it('should never select an environment snapshot as files', () => {
    const { result: hook } = renderHook(() => useCleanupSelection(result));

    act(() => hook.current.toggle(result.items, true));

    expect(hook.current.chosen.map((item) => item.category)).not.toContain('environments');
    expect(hook.current.bytes).toBe(1000);
  });

  it('should drop an item the analysis no longer lists, and unselect on toggle off', () => {
    const { rerender, result: hook } = renderHook(({ value }) => useCleanupSelection(value), {
      initialProps: { value: result },
    });
    act(() => hook.current.toggle(result.items.slice(0, 3), true));
    act(() => hook.current.toggle([result.items[1]], false));
    expect(hook.current.chosen).toHaveLength(2);

    rerender({ value: { ...result, items: result.items.slice(1) } });

    expect(hook.current.chosen.map((item) => item.path)).toEqual(['app/data.bin']);
    act(() => hook.current.clear());
    expect(hook.current.chosen).toEqual([]);
  });
});

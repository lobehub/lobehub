/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  compressedGroupExpandedKey,
  compressedGroupTabKey,
  useGroupPreferences,
} from './useGroupPreferences';

const GROUP_ID = 'ccg-test-group';
const EXPANDED_KEY = compressedGroupExpandedKey(GROUP_ID);
const TAB_KEY = compressedGroupTabKey(GROUP_ID);

/**
 * The values seen at RENDER time, in order — `observed[0]` is the first render.
 * Reading `result.current` alone would not tell a synchronous read from one that
 * hydrates in an effect, because testing-library flushes effects before returning.
 */
const renderPreferences = () => {
  const observed: { activeTab: string; expanded: boolean }[] = [];

  const { result, unmount } = renderHook(() => {
    const preferences = useGroupPreferences(GROUP_ID);

    observed.push({ activeTab: preferences.activeTab, expanded: preferences.expanded });

    return preferences;
  });

  return { observed, result, unmount };
};

describe('useGroupPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads a stored fold on the first render, not after one', () => {
    localStorage.setItem(EXPANDED_KEY, 'false');

    const { observed } = renderPreferences();

    // A deferred (effect-based) read renders `true` here and folds afterwards,
    // which is what painted the whole summary before collapsing it.
    expect(observed[0]).toEqual({ activeTab: 'summary', expanded: false });
  });

  it('reads the stored tab on the first render', () => {
    localStorage.setItem(TAB_KEY, 'history');

    expect(renderPreferences().observed[0].activeTab).toBe('history');
  });

  it('defaults to the summary tab and an open group when nothing is stored', () => {
    expect(renderPreferences().observed[0]).toEqual({ activeTab: 'summary', expanded: true });
  });

  it('keeps the stored fold across an unmount and remount', () => {
    localStorage.setItem(EXPANDED_KEY, 'false');

    const first = renderPreferences();
    expect(first.observed[0].expanded).toBe(false);
    first.unmount();

    expect(renderPreferences().observed[0].expanded).toBe(false);
  });

  it('writes the fold on toggle', () => {
    const { result } = renderPreferences();
    expect(result.current.expanded).toBe(true);

    act(() => result.current.toggleExpanded());

    expect(localStorage.getItem(EXPANDED_KEY)).toBe('false');
    expect(result.current.expanded).toBe(false);

    act(() => result.current.toggleExpanded());

    expect(localStorage.getItem(EXPANDED_KEY)).toBe('true');
    expect(result.current.expanded).toBe(true);
  });

  it('writes the tab on selection', () => {
    const { result } = renderPreferences();

    act(() => result.current.setActiveTab('history'));

    expect(localStorage.getItem(TAB_KEY)).toBe('history');
    expect(result.current.activeTab).toBe('history');
  });
});

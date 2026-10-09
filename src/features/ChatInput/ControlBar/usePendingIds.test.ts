import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePendingIds } from './usePendingIds';

describe('usePendingIds', () => {
  it('keeps a later request busy when an earlier overlapping one settles first', () => {
    const { result } = renderHook(() => usePendingIds());

    act(() => result.current.add('a'));
    act(() => result.current.add('b'));
    expect(result.current.has('a')).toBe(true);
    expect(result.current.has('b')).toBe(true);

    // A settles first; B is still in flight and must stay busy.
    act(() => result.current.remove('a'));
    expect(result.current.has('a')).toBe(false);
    expect(result.current.has('b')).toBe(true);

    act(() => result.current.remove('b'));
    expect(result.current.has('b')).toBe(false);
  });

  it('ignores removing an id that is not pending', () => {
    const { result } = renderHook(() => usePendingIds());

    act(() => result.current.add('a'));
    act(() => result.current.remove('missing'));

    expect(result.current.has('a')).toBe(true);
  });
});

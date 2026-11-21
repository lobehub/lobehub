import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLazyMenuItems, usePublishMenuItems } from './useLazyMenuItems';

describe('useLazyMenuItems', () => {
  it('starts unarmed with an empty menu', () => {
    const { result } = renderHook(() => useLazyMenuItems());

    expect(result.current.armed).toBe(false);
    expect(result.current.items()).toEqual([]);
  });

  it('arms once and keeps the items thunk stable', () => {
    const { result } = renderHook(() => useLazyMenuItems());
    const { items } = result.current;

    act(() => result.current.arm());

    expect(result.current.armed).toBe(true);
    expect(result.current.items).toBe(items);
  });

  it('serves the latest builder the host published', () => {
    const { result } = renderHook(() => useLazyMenuItems());
    const { rerender } = renderHook(
      ({ label }) => usePublishMenuItems(result.current.builderRef, () => [{ key: label, label }]),
      { initialProps: { label: 'first' } },
    );

    expect(result.current.items()).toEqual([{ key: 'first', label: 'first' }]);

    rerender({ label: 'second' });

    expect(result.current.items()).toEqual([{ key: 'second', label: 'second' }]);
  });
});

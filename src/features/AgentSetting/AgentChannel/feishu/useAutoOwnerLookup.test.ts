import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoOwnerLookup } from './useAutoOwnerLookup';

describe('automatic owner lookup timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('only requests the settled credential pair after a sequence of edits', () => {
    const lookup = vi.fn();
    const { rerender } = renderHook(
      ({ secret }) =>
        useAutoOwnerLookup({
          appId: 'app',
          secret,
          platformId: 'feishu',
          onLookup: () => lookup(secret),
        }),
      { initialProps: { secret: 's' } },
    );
    for (const secret of ['se', 'sec', 'secret']) {
      act(() => vi.advanceTimersByTime(100));
      rerender({ secret });
    }
    act(() => vi.advanceTimersByTime(599));
    expect(lookup).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(lookup.mock.calls).toEqual([['secret']]);
    rerender({ secret: 'secret' });
    act(() => vi.advanceTimersByTime(1000));
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'saved', 'unmounted', 'manual'])(
    'cancels a pending automatic lookup when %s',
    (reason) => {
      const lookup = vi.fn();
      const { rerender, unmount, result } = renderHook(
        ({ disabled, savedValue }) =>
          useAutoOwnerLookup({
            appId: 'app',
            secret: 'secret',
            platformId: 'lark',
            onLookup: lookup,
            disabled,
            savedValue,
          }),
        { initialProps: { disabled: false, savedValue: '' } },
      );
      act(() => vi.advanceTimersByTime(200));
      if (reason === 'disabled') rerender({ disabled: true, savedValue: '' });
      if (reason === 'saved') rerender({ disabled: false, savedValue: 'owner' });
      if (reason === 'unmounted') unmount();
      if (reason === 'manual') act(() => result.current());
      act(() => vi.advanceTimersByTime(1000));
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('re-arms for corrected credentials and a different platform', () => {
    const lookup = vi.fn();
    const { rerender } = renderHook(
      ({ secret, platformId }) =>
        useAutoOwnerLookup({
          appId: 'app',
          secret,
          platformId,
          onLookup: () => lookup(platformId, secret),
        }),
      { initialProps: { secret: 'first', platformId: 'feishu' } },
    );
    act(() => vi.advanceTimersByTime(600));
    rerender({ secret: 'corrected', platformId: 'feishu' });
    act(() => vi.advanceTimersByTime(600));
    rerender({ secret: 'corrected', platformId: 'lark' });
    act(() => vi.advanceTimersByTime(600));
    expect(lookup.mock.calls).toEqual([
      ['feishu', 'first'],
      ['feishu', 'corrected'],
      ['lark', 'corrected'],
    ]);
  });
});

/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ForwardPagingUnsupportedError } from '@/services/message/roundCursorPage';

import { useForwardPagingFallback } from './useForwardPagingFallback';

describe('useForwardPagingFallback', () => {
  it('hands a forward list back to newest-first when the server cannot page forward', () => {
    const onUnsupported = vi.fn();

    const { result } = renderHook(() =>
      useForwardPagingFallback({
        errors: [new ForwardPagingUnsupportedError()],
        onUnsupported,
        paging: 'forward',
      }),
    );

    expect(result.current).toBe(true);
    expect(onUnsupported).toHaveBeenCalledTimes(1);
  });

  it('leaves other failures and newest-first lists to the usual error rows', () => {
    const onUnsupported = vi.fn();

    const network = renderHook(() =>
      useForwardPagingFallback({
        errors: [new Error('network down'), undefined],
        onUnsupported,
        paging: 'forward',
      }),
    );
    const backward = renderHook(() =>
      useForwardPagingFallback({
        errors: [new ForwardPagingUnsupportedError()],
        onUnsupported,
        paging: 'backward',
      }),
    );

    expect(network.result.current).toBe(false);
    expect(backward.result.current).toBe(false);
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it('does not hide the failure when nothing can switch the list', () => {
    const { result } = renderHook(() =>
      useForwardPagingFallback({
        errors: [new ForwardPagingUnsupportedError()],
        paging: 'forward',
      }),
    );

    expect(result.current).toBe(false);
  });
});

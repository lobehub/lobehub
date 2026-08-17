import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useActingRequests } from './useActingRequests';

describe('useActingRequests', () => {
  it('tracks concurrent requests independently — one settling never frees the other', () => {
    const { result } = renderHook(() => useActingRequests());

    act(() => result.current.beginActing('req-a'));
    act(() => result.current.beginActing('req-b'));
    expect(result.current.isActing('req-a')).toBe(true);
    expect(result.current.isActing('req-b')).toBe(true);

    // The regression this guards: with scalar state, starting req-b's action
    // re-enabled req-a mid-flight, and req-a settling cleared req-b's spinner.
    act(() => result.current.endActing('req-a'));
    expect(result.current.isActing('req-a')).toBe(false);
    expect(result.current.isActing('req-b')).toBe(true);

    act(() => result.current.endActing('req-b'));
    expect(result.current.isActing('req-b')).toBe(false);
  });

  it('stays acting while begun, regardless of unrelated requests settling', () => {
    const { result } = renderHook(() => useActingRequests());

    act(() => result.current.beginActing('req-a'));
    act(() => result.current.endActing('req-unrelated'));
    expect(result.current.isActing('req-a')).toBe(true);
  });
});

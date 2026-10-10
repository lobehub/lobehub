import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useImeAwareQuery } from './useImeAwareQuery';

describe('useImeAwareQuery', () => {
  it('follows plain typing immediately', () => {
    const { result } = renderHook(() => useImeAwareQuery());

    act(() => result.current.inputProps.onInputChange('api'));

    expect(result.current.query).toBe('api');
    expect(result.current.inputProps.value).toBe('api');
  });

  it('holds the query during IME composition and commits on compositionend', () => {
    const { result } = renderHook(() => useImeAwareQuery());

    act(() => {
      result.current.inputProps.onCompositionStart();
      result.current.inputProps.onInputChange("yu'y");
    });

    expect(result.current.inputProps.value).toBe("yu'y");
    expect(result.current.query).toBe('');

    // Chrome order: final input event, then compositionend
    act(() => {
      result.current.inputProps.onInputChange('语言');
      result.current.inputProps.onCompositionEnd({ currentTarget: { value: '语言' } });
    });

    expect(result.current.query).toBe('语言');
  });

  it('commits when compositionend fires before the final input event (Safari)', () => {
    const { result } = renderHook(() => useImeAwareQuery());

    act(() => {
      result.current.inputProps.onCompositionStart();
      result.current.inputProps.onInputChange('she');
      result.current.inputProps.onCompositionEnd({ currentTarget: { value: '设置' } });
      result.current.inputProps.onInputChange('设置');
    });

    expect(result.current.query).toBe('设置');
  });
});

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useReplySettling } from './useReplySettling';

describe('useReplySettling', () => {
  it('keeps following once a reply finishes, until it settles', () => {
    const { result, rerender } = renderHook(({ generating }) => useReplySettling(generating), {
      initialProps: { generating: true },
    });
    expect(result.current.settling).toBe(false);

    // Regression: following stopped with generation, so a card that laid out its chart after the
    // last chunk was left below the fold.
    rerender({ generating: false });
    expect(result.current.settling).toBe(true);

    act(() => result.current.settle());
    expect(result.current.settling).toBe(false);
  });

  it('does not settle a conversation that was opened idle', () => {
    const { result } = renderHook(() => useReplySettling(false));

    expect(result.current.settling).toBe(false);
  });

  it('clears settling when the next generation starts', () => {
    const { result, rerender } = renderHook(({ generating }) => useReplySettling(generating), {
      initialProps: { generating: true },
    });
    rerender({ generating: false });
    rerender({ generating: true });

    expect(result.current.settling).toBe(false);
  });
});

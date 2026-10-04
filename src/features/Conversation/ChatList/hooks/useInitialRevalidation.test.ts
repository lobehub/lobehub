import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useInitialRevalidation } from './useInitialRevalidation';

describe('useInitialRevalidation', () => {
  it('reports the first revalidation of a conversation only', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-a', isValidating: true },
    });
    expect(result.current).toBe(true);

    rerender({ identity: 'topic-a', isValidating: false });
    expect(result.current).toBe(false);

    // A later focus / polling revalidation of the same conversation stays silent.
    rerender({ identity: 'topic-a', isValidating: true });
    expect(result.current).toBe(false);
  });

  it('reports again after switching to another conversation', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-a', isValidating: true },
    });
    rerender({ identity: 'topic-a', isValidating: false });

    rerender({ identity: 'topic-b', isValidating: true });
    expect(result.current).toBe(true);
  });

  it('reports again when reopening a settled conversation through one that never validated', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-a', isValidating: true },
    });
    rerender({ identity: 'topic-a', isValidating: false });

    // B renders from a still-verified cache and never starts a fetch.
    rerender({ identity: 'topic-b', isValidating: false });

    // Back on A after its verification window lapsed: a new first fetch.
    rerender({ identity: 'topic-a', isValidating: true });
    expect(result.current).toBe(true);
  });

  it('stays hidden while no fetch is in flight', () => {
    const { result } = renderHook(() =>
      useInitialRevalidation({ identity: 'topic-a', isValidating: false }),
    );
    expect(result.current).toBe(false);
  });
});

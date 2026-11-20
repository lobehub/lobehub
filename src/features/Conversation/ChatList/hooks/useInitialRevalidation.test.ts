import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useInitialRevalidation } from './useInitialRevalidation';

const verified = () => true;
const unverified = () => false;

describe('useInitialRevalidation', () => {
  it('reports the first revalidation of a conversation only', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-a', isServerVerified: unverified, isValidating: true },
    });
    expect(result.current).toBe(true);

    rerender({ identity: 'topic-a', isServerVerified: unverified, isValidating: false });
    expect(result.current).toBe(false);

    // A later focus / polling revalidation of the same conversation stays silent.
    rerender({ identity: 'topic-a', isServerVerified: unverified, isValidating: true });
    expect(result.current).toBe(false);
  });

  it('reports again after switching to another conversation', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-a', isServerVerified: unverified, isValidating: true },
    });
    rerender({ identity: 'topic-a', isServerVerified: unverified, isValidating: false });

    rerender({ identity: 'topic-b', isServerVerified: unverified, isValidating: true });
    expect(result.current).toBe(true);
  });

  it('reports again when reopening a settled conversation through one that never validated', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-a', isServerVerified: unverified, isValidating: true },
    });
    rerender({ identity: 'topic-a', isServerVerified: unverified, isValidating: false });

    // B renders from a still-verified cache and never starts a fetch.
    rerender({ identity: 'topic-b', isServerVerified: verified, isValidating: false });

    // Back on A after its verification window lapsed: a new first fetch.
    rerender({ identity: 'topic-a', isServerVerified: unverified, isValidating: true });
    expect(result.current).toBe(true);
  });

  it('treats a later refresh as non-initial when the opening started from verified cache', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-b', isServerVerified: verified, isValidating: false },
    });

    // Verification window lapses; a focus / polling refresh starts.
    rerender({ identity: 'topic-b', isServerVerified: unverified, isValidating: true });
    expect(result.current).toBe(false);
  });

  it('reports the switch-time fetch even before SWR flags it', () => {
    const { rerender, result } = renderHook((props) => useInitialRevalidation(props), {
      initialProps: { identity: 'topic-a', isServerVerified: unverified, isValidating: false },
    });
    // The switch render reports isValidating=false; the fetch starts right after.
    rerender({ identity: 'topic-a', isServerVerified: unverified, isValidating: true });
    expect(result.current).toBe(true);
  });

  it('stays hidden while no fetch is in flight', () => {
    const { result } = renderHook(() =>
      useInitialRevalidation({
        identity: 'topic-a',
        isServerVerified: unverified,
        isValidating: false,
      }),
    );
    expect(result.current).toBe(false);
  });
});

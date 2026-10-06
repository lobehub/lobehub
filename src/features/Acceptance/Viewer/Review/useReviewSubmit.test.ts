import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReviewSubmit } from './useReviewSubmit';

afterEach(() => vi.restoreAllMocks());

describe('feedback submission recovery', () => {
  it('keeps a visible failure until the user retries successfully', async () => {
    const { result } = renderHook(useReviewSubmit);
    await act(async () => {
      await result.current.submit(async () => false);
    });
    expect(result.current.failed).toBe(true);
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await result.current.submit(async () => true);
    });
    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('recovers from thrown errors and suppresses concurrent submissions', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(useReviewSubmit);
    const duplicate = vi.fn(async () => true);
    let reject!: (reason: Error) => void;
    const request = new Promise<boolean>((_, fail) => {
      reject = fail;
    });
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.submit(() => request);
    });
    await act(async () => {
      await result.current.submit(duplicate);
    });
    expect(duplicate).not.toHaveBeenCalled();
    await act(async () => {
      reject(new Error('offline'));
      await first;
    });
    expect(result.current.failed).toBe(true);
    expect(result.current.loading).toBe(false);
  });
});

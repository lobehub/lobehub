import { afterEach, describe, expect, it, vi } from 'vitest';

import { anySignal } from './abortSignal';

describe('anySignal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts once any source aborts, without AbortSignal.any', () => {
    // Older browsers have no AbortSignal.any
    vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new TypeError('AbortSignal.any is not a function');
    });
    const view = new AbortController();
    const request = new AbortController();

    const { signal } = anySignal([view.signal, request.signal]);
    expect(signal.aborted).toBe(false);

    request.abort();
    expect(signal.aborted).toBe(true);
  });

  it('starts aborted when a source already is', () => {
    const request = new AbortController();
    request.abort();

    expect(anySignal([new AbortController().signal, request.signal]).signal.aborted).toBe(true);
  });

  it('leaves no listener on its sources once disposed', () => {
    const view = new AbortController();
    const added = vi.spyOn(view.signal, 'addEventListener');
    const removed = vi.spyOn(view.signal, 'removeEventListener');

    const { dispose, signal } = anySignal([view.signal, new AbortController().signal]);
    dispose();

    expect(removed.mock.calls.map(([, listener]) => listener)).toEqual(
      added.mock.calls.map(([, listener]) => listener),
    );
    view.abort();
    expect(signal.aborted).toBe(false);
  });
});

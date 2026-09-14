/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQuickNotePersistenceLifecycle } from './useQuickNotePersistenceLifecycle';

const flushPendingWritesMock = vi.hoisted(() => vi.fn());

vi.mock('@/store/quickNote', () => ({
  useQuickNoteStore: (
    selector: (state: { flushPendingWrites: typeof flushPendingWritesMock }) => unknown,
  ) => selector({ flushPendingWrites: flushPendingWritesMock }),
}));

describe('useQuickNotePersistenceLifecycle', () => {
  afterEach(() => {
    flushPendingWritesMock.mockReset();
  });

  /** @example Closing or reloading the page starts the pending server write immediately. */
  it('flushes pending writes on pagehide and unmount', () => {
    const view = renderHook(() => useQuickNotePersistenceLifecycle());

    window.dispatchEvent(new Event('pagehide'));

    /** @example The pagehide lifecycle flushes the store debounce. */
    expect(flushPendingWritesMock).toHaveBeenCalledTimes(1);

    view.unmount();

    /** @example SPA route teardown performs the same best-effort flush. */
    expect(flushPendingWritesMock).toHaveBeenCalledTimes(2);
  });
});

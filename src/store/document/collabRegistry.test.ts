import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerPageCollab, waitForPageSynced } from './collabRegistry';

describe('waitForPageSynced', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when the page has no live room', async () => {
    expect(await waitForPageSynced('doc_unknown', 1000)).toBe(true);
  });

  it('waits for pending edits to be acknowledged', async () => {
    const source = { pendingCount: 2 };
    const unregister = registerPageCollab('doc_1', source);
    setTimeout(() => {
      source.pendingCount = 0;
    }, 150);

    expect(await waitForPageSynced('doc_1', 2000)).toBe(true);
    unregister();
  });

  it('gives up after the timeout while edits are still pending', async () => {
    const unregister = registerPageCollab('doc_2', { pendingCount: 1 });

    expect(await waitForPageSynced('doc_2', 250)).toBe(false);
    unregister();
  });
});

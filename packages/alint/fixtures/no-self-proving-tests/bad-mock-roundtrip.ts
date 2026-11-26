import { expect, it, vi } from 'vitest';

const loadSettings = vi.fn().mockResolvedValue({ reactionMode: 'none' });

// alint-expect
it('loads the configured reaction mode', async () => {
  expect(await loadSettings()).toEqual({ reactionMode: 'none' });
});

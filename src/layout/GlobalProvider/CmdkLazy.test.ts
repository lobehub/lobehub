import { describe, expect, it, vi } from 'vitest';

const CHUNK_INIT_ERROR =
  'RangeError: WebAssembly.Compile is disallowed on the main thread, if the buffer size is larger than 4KB.';

/**
 * Regression: the mobile layout mounts `CmdkLazy` unconditionally, so the
 * CommandMenu chunk starts loading on every page. On Chromium builds that
 * reject synchronous WebAssembly compilation above 4KB on the main thread the
 * chunk rejects during module evaluation. The loader must absorb that
 * rejection so the app shell keeps mounting without global search.
 */
describe('loadCommandMenu', () => {
  it('resolves to a no-op component when the CommandMenu chunk rejects during init', async () => {
    vi.resetModules();
    vi.doMock('@/features/CommandMenu', () => {
      throw new Error(CHUNK_INIT_ERROR);
    });

    const { loadCommandMenu } = await import('./CmdkLazy');

    await expect(loadCommandMenu()).resolves.toMatchObject({ default: expect.any(Function) });
  });

  it('resolves the real CommandMenu module when the chunk loads', async () => {
    vi.resetModules();
    const CommandMenu = () => null;
    vi.doMock('@/features/CommandMenu', () => ({ default: CommandMenu }));

    const { loadCommandMenu } = await import('./CmdkLazy');

    await expect(loadCommandMenu()).resolves.toMatchObject({ default: CommandMenu });
  });
});

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Regression: the mobile layout mounts `CmdkLazy` unconditionally, which starts
 * loading the CommandMenu chunk (and its Shiki/oniguruma WASM payload) on every
 * page. On Chromium builds that reject synchronous WebAssembly compilation above
 * 4KB on the main thread the chunk throws during module evaluation. Without a
 * local boundary that render error bubbles to the app root and the whole shell
 * never mounts ("temporarily unavailable").
 */
const flushChunkInit = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('CmdkLazy', () => {
  it('keeps the app shell mounted when the CommandMenu chunk fails to initialize', async () => {
    vi.resetModules();

    vi.doMock('@/features/CommandMenu', () => {
      throw new Error(
        'RangeError: WebAssembly.Compile is disallowed on the main thread, if the buffer size is larger than 4KB.',
      );
    });

    const { default: CmdkLazy } = await import('./CmdkLazy');

    render(
      <div>
        <p data-testid="app-shell">app shell</p>
        <CmdkLazy />
      </div>,
    );

    await flushChunkInit();

    // A broken search chunk must only remove global search, never the shell.
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('command-menu')).not.toBeInTheDocument();
  });

  it('renders the command menu when the chunk loads', async () => {
    vi.resetModules();

    vi.doMock('@/features/CommandMenu', () => ({
      default: () => <p data-testid="command-menu">command menu</p>,
    }));

    const { default: CmdkLazy } = await import('./CmdkLazy');

    render(<CmdkLazy />);

    expect(await screen.findByTestId('command-menu')).toBeInTheDocument();
  });
});

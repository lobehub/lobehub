import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';

import ChatTerminalPanel from './index';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('@lobehub/ui', () => ({
  DraggablePanel: ({ children, expand }: { children?: ReactNode; expand?: boolean }) => (
    <div data-expand={String(expand)} data-testid="terminal-panel">
      {children}
    </div>
  ),
}));

vi.mock('./Content', () => ({
  default: () => <div data-testid="terminal-content" />,
}));

const setShow = (showTerminalPanel: boolean) =>
  act(() => {
    useGlobalStore.setState({
      status: { ...useGlobalStore.getState().status, showTerminalPanel },
    });
  });

beforeEach(() => {
  useGlobalStore.setState({ status: { ...initialState.status } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChatTerminalPanel', () => {
  it('drives open/close through controlled expand instead of unmounting', async () => {
    render(<ChatTerminalPanel />);

    // Closed: the panel is mounted (so it can animate) with expand=false,
    // rather than returning null as the old implementation did.
    expect(screen.getByTestId('terminal-panel').dataset.expand).toBe('false');

    setShow(true);
    await waitFor(() => expect(screen.getByTestId('terminal-panel').dataset.expand).toBe('true'));

    setShow(false);
    expect(screen.getByTestId('terminal-panel').dataset.expand).toBe('false');
  });

  it('defers Content until first open, then unmounts it after the collapse animation', async () => {
    render(<ChatTerminalPanel />);

    expect(screen.queryByTestId('terminal-content')).toBeNull();

    setShow(true);
    expect(await screen.findByTestId('terminal-content')).toBeDefined();

    vi.useFakeTimers();
    try {
      setShow(false);
      // Kept mounted while the panel collapses.
      expect(screen.getByTestId('terminal-content')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(300);
      });
      // Unmounted once hidden, releasing the xterm canvas.
      expect(screen.queryByTestId('terminal-content')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

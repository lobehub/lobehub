import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ZoomHUD from './index';

type Handler = (payload: { factor: number; level: number }) => void;

let registeredHandler: Handler | null = null;

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (_event: string, handler: Handler) => {
    registeredHandler = handler;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('motion/react', async () => {
  const React = await import('react');
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    m: new Proxy(
      {},
      {
        get:
          () =>
          ({ children, ...rest }: any) =>
            React.createElement('div', rest, children),
      },
    ),
  };
});

const emit = (factor: number, level: number) => {
  act(() => {
    registeredHandler?.({ factor, level });
  });
};

describe('ZoomHUD', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registeredHandler = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing before any zoom event', () => {
    render(<ZoomHUD />);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('shows formatted percentage when event fires', () => {
    render(<ZoomHUD />);
    emit(1.2, 1);
    expect(screen.getByText('120%')).toBeInTheDocument();
  });

  it('hides after 1500ms of inactivity', () => {
    render(<ZoomHUD />);
    emit(1.2, 1);
    expect(screen.getByText('120%')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(screen.getByText('120%')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('resets the hide timer on rapid successive events', () => {
    render(<ZoomHUD />);
    emit(1.2, 1);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    emit(1.44, 2);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByText('144%')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('rounds factor for display', () => {
    render(<ZoomHUD />);
    emit(0.8333, -1);
    expect(screen.getByText('83%')).toBeInTheDocument();
  });
});

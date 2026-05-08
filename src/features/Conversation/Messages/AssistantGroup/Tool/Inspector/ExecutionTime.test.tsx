/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExecutionTime from './ExecutionTime';

vi.mock('@lobehub/ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

describe('ExecutionTime', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('uses the provided operation start time after remounting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { unmount } = render(
      <ExecutionTime isExecuting startTime={8000} timerKey="tool-with-operation" />,
    );

    expect(screen.getByText('2.0s')).toBeTruthy();

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    render(<ExecutionTime isExecuting startTime={8000} timerKey="tool-with-operation" />);

    expect(screen.getByText('3.0s')).toBeTruthy();
  });

  it('keeps the cached start time when the timer remounts without operation metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { unmount } = render(<ExecutionTime isExecuting timerKey="tool-with-cache" />);

    expect(screen.getByText('0ms')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.getByText('2.5s')).toBeTruthy();

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    render(<ExecutionTime isExecuting timerKey="tool-with-cache" />);

    expect(screen.getByText('3.5s')).toBeTruthy();
  });
});

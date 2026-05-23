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

  it('clears the cached start time when an active timer stays unmounted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { unmount } = render(<ExecutionTime isExecuting timerKey="tool-active-unmount" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('1.5s')).toBeTruthy();

    unmount();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    render(<ExecutionTime isExecuting timerKey="tool-active-unmount" />);

    expect(screen.getByText('0ms')).toBeTruthy();
  });

  it('formats elapsed times longer than a minute as Xmin Ys', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { rerender } = render(
      <ExecutionTime isExecuting startTime={10_000} timerKey="tool-minutes" />,
    );

    act(() => {
      vi.advanceTimersByTime(83_000);
    });

    expect(screen.getByText('1min23s')).toBeTruthy();

    rerender(<ExecutionTime isExecuting startTime={10_000} timerKey="tool-minutes" />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText('2min23s')).toBeTruthy();
  });

  it('clears the cached start time when execution stops', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { rerender } = render(<ExecutionTime isExecuting timerKey="tool-stop" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('1.5s')).toBeTruthy();

    rerender(<ExecutionTime isExecuting={false} timerKey="tool-stop" />);

    expect(screen.queryByText('1.5s')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    rerender(<ExecutionTime isExecuting timerKey="tool-stop" />);

    expect(screen.getByText('0ms')).toBeTruthy();
  });
});

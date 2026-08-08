import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveTopicTriggerTime, RunningElapsedTime } from './RunningElapsedTime';

describe('RunningElapsedTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks from the operation start time once per second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T00:12:00Z'));

    render(<RunningElapsedTime startTime={'2026-07-23T00:00:00Z'} />);

    expect(screen.getByText('12:00')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('12:01')).toBeInTheDocument();
  });

  it('renders nothing when no operation start exists', () => {
    const { container } = render(<RunningElapsedTime />);

    expect(container).toBeEmptyDOMElement();
  });

  it('uses the operation start for the relative trigger time and keeps a fallback', () => {
    const operationStart = '2026-07-23T00:00:00Z';
    const updatedAt = '2026-07-23T00:11:59Z';

    expect(resolveTopicTriggerTime(operationStart, updatedAt)).toBe(operationStart);
    expect(resolveTopicTriggerTime(null, updatedAt)).toBe(updatedAt);
  });
});

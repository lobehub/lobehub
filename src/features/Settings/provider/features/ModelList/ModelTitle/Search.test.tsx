import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Search from './Search';

describe('ModelList Search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('should clear immediately without waiting for debounce', () => {
    const onChange = vi.fn();

    render(<Search value="abc" onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('should not replay stale debounced value after external reset', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Search value="abc" onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcd' } });

    rerender(<Search value="" onChange={onChange} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onChange).not.toHaveBeenCalledWith('abcd');
  });
});

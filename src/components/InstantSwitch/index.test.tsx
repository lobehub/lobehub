import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InstantSwitch from './index';

describe('InstantSwitch', () => {
  it('keeps the new value once the save succeeds', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<InstantSwitch enabled={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('goes back to the stored value when the save fails', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('offline'));
    render(<InstantSwitch enabled={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'),
    );
  });
});

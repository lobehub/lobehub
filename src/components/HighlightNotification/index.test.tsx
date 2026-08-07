import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HighlightNotification from '.';

describe('HighlightNotification', () => {
  it('keeps long notification copy clear of the visible close action', () => {
    const onClose = vi.fn();
    const title = 'WeChat Integration Service Update';
    const description =
      'Using WeChat integration will require a paid plan starting from July 10. Learn More';

    render(
      <HighlightNotification open description={description} title={title} onClose={onClose} />,
    );

    const copy = screen.getByText(title).parentElement;
    const closeButton = screen.getByRole('button');

    expect(copy).toHaveStyle({ paddingInlineEnd: '32px' });
    expect(screen.getByText(description)).toBeVisible();
    expect(closeButton).toBeVisible();

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

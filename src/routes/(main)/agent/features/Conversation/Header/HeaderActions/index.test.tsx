import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HeaderActions from './index';

vi.mock('./useMenu', () => ({
  useMenu: () => ({
    menuHeader: <div data-testid={'topic-info-header'} />,
    menuItems: [],
  }),
}));

describe('Conversation header actions', () => {
  it('renders the overflow actions button', () => {
    render(<HeaderActions />);

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('passes the topic info header to the dropdown', async () => {
    render(<HeaderActions />);

    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByTestId('topic-info-header')).toBeInTheDocument();
  });
});

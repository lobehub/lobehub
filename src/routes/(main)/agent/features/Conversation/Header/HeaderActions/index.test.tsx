import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import HeaderActions from './index';

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button data-testid={'overflow-menu-button'} />,
  DropdownMenu: ({ children, header }: { children?: ReactNode; header?: ReactNode }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock('./useMenu', () => ({
  useMenu: () => ({
    menuHeader: <div data-testid={'topic-info-header'} />,
    menuItems: [],
  }),
}));

describe('Conversation header actions', () => {
  it('renders the overflow actions button', () => {
    render(<HeaderActions />);

    expect(screen.getByTestId('overflow-menu-button')).toBeInTheDocument();
  });

  it('passes the topic info header to the dropdown', () => {
    render(<HeaderActions />);

    expect(screen.getByTestId('topic-info-header')).toBeInTheDocument();
  });
});

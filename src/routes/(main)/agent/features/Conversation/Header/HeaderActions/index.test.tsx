import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import HeaderActions from './index';

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button data-testid={'overflow-menu-button'} />,
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./useMenu', () => ({
  useMenu: () => ({
    menuItems: [],
  }),
}));

describe('Conversation header actions', () => {
  it('renders the overflow actions button', () => {
    render(<HeaderActions />);

    expect(screen.getByTestId('overflow-menu-button')).toBeInTheDocument();
  });
});

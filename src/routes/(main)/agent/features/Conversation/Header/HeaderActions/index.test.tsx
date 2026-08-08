import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import HeaderActions from './index';

const { toggleTerminalPanel } = vi.hoisted(() => ({
  toggleTerminalPanel: vi.fn(),
}));

vi.mock('@/const/version', () => ({ isDesktop: true }));

vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: { toggleTerminalPanel: typeof toggleTerminalPanel }) => unknown,
  ) => selector({ toggleTerminalPanel }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ title, onClick }: { title?: string; onClick?: () => void }) => (
    <button
      aria-label={title}
      data-testid={title ? undefined : 'overflow-menu-button'}
      onClick={onClick}
    />
  ),
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

  it('opens the terminal directly from the desktop header', () => {
    render(<HeaderActions />);

    fireEvent.click(screen.getByRole('button', { name: 'terminalPanel.title' }));

    expect(toggleTerminalPanel).toHaveBeenCalledWith(true);
  });
});

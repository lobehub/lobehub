import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import PanelContent from '../UserPanel/PanelContent';

// Mock dependencies
vi.mock('zustand/traditional');

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('@/components/BrandWatermark', () => ({
  default: vi.fn(() => <div>Mocked BrandWatermark</div>),
}));

vi.mock('@/components/Menu', () => ({
  default: vi.fn(({ items, onClick }) => (
    <div>
      Mocked Menu
      {items.map((item: any) => (
        <button key={item.key} type={'button'} onClick={onClick}>
          {item.label}
        </button>
      ))}
    </div>
  )),
}));

vi.mock('../UserInfo', () => ({
  default: vi.fn(({ onClick }) => (
    <button type={'button'} onClick={onClick}>
      Mocked UserInfo
    </button>
  )),
}));

vi.mock('../UserPanel/useMenu', () => ({
  useMenu: vi.fn(() => ({
    logoutItems: [{ key: 'logout', label: 'Logout' }],
    mainItems: [
      { key: 'item1', label: 'Main Item 1' },
      { key: 'item2', label: 'Main Item 2' },
    ],
  })),
}));

vi.mock('../UserLoginOrSignup', () => ({
  default: vi.fn(({ onClick }) => (
    <button type={'button'} onClick={onClick}>
      Mocked SignInBlock
    </button>
  )),
}));

vi.mock('../DataStatistics', () => ({
  default: vi.fn(() => <div>Mocked DataStatistics</div>),
}));

vi.mock('@/const/version', () => ({
  isDeprecatedEdition: false,
  isDesktop: false,
}));

describe('PanelContent', () => {
  const closePopover = vi.fn();

  // Helper function to render component with Router provider
  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
  };

  describe('enable auth', () => {
    it('should render UserInfo when user is signed in', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: true });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getByText('Mocked UserInfo')).toBeInTheDocument();
      expect(screen.getByText('Mocked DataStatistics')).toBeInTheDocument();
      expect(screen.queryByText('Mocked SignInBlock')).not.toBeInTheDocument();
    });

    it('should render SignInBlock when user is not signed in and enable auth', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: false });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getByText('Mocked SignInBlock')).toBeInTheDocument();
      expect(screen.queryByText('Mocked DataStatistics')).not.toBeInTheDocument();
      expect(screen.queryByText('Mocked UserInfo')).not.toBeInTheDocument();
    });

    it('should render logout items when user is signed in', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: true });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getAllByText('Mocked Menu').length).toBe(2);
    });

    it('should render BrandWatermark when user is not signed in', () => {
      act(() => {
        useUserStore.setState({ isSignedIn: false });
      });

      renderWithRouter(<PanelContent closePopover={closePopover} />);

      expect(screen.getByText('Mocked BrandWatermark')).toBeInTheDocument();
    });
  });

  it('should render Menu with main items', () => {
    renderWithRouter(<PanelContent closePopover={closePopover} />);

    expect(screen.getAllByText('Mocked Menu').length).toBeGreaterThan(0);
  });
});

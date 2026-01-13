import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import UserBanner from '../features/UserBanner';

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/features/User/UserInfo', () => ({
  default: vi.fn(() => <div>Mocked UserInfo</div>),
}));

vi.mock('@/features/User/DataStatistics', () => ({
  default: vi.fn(() => <div>Mocked DataStatistics</div>),
}));

vi.mock('@/features/User/UserLoginOrSignup/Community', () => ({
  default: vi.fn(() => <div>Mocked UserLoginOrSignup</div>),
}));

vi.mock('@/const/version', () => ({
  isDeprecatedEdition: false,
  isDesktop: false,
}));

// Use vi.hoisted to ensure variables exist before vi.mock factory executes
const { enableAuth, enableClerk } = vi.hoisted(() => ({
  enableAuth: { value: true },
  enableClerk: { value: false },
}));

vi.mock('@/envs/auth', () => ({
  get enableAuth() {
    return enableAuth.value;
  },
  get enableClerk() {
    return enableClerk.value;
  },
}));

afterEach(() => {
  enableAuth.value = true;
  enableClerk.value = false;
  mockNavigate.mockReset();
});

describe('UserBanner', () => {
  it('should render UserInfo and DataStatistics when auth is disabled', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });
    enableAuth.value = false;

    render(<UserBanner />);

    expect(screen.getByText('Mocked UserInfo')).toBeInTheDocument();
    expect(screen.getByText('Mocked DataStatistics')).toBeInTheDocument();
    expect(screen.queryByText('Mocked UserLoginOrSignup')).not.toBeInTheDocument();
  });

  it('should render UserInfo and DataStatistics when user is logged in with auth enabled', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    enableClerk.value = true;

    render(<UserBanner />);

    expect(screen.getByText('Mocked UserInfo')).toBeInTheDocument();
    expect(screen.getByText('Mocked DataStatistics')).toBeInTheDocument();
    expect(screen.queryByText('Mocked UserLoginOrSignup')).not.toBeInTheDocument();
  });

  it('should render UserLoginOrSignup when user is not logged in with auth enabled', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });
    enableClerk.value = true;

    render(<UserBanner />);

    expect(screen.getByText('Mocked UserLoginOrSignup')).toBeInTheDocument();
    expect(screen.queryByText('Mocked UserInfo')).not.toBeInTheDocument();
    expect(screen.queryByText('Mocked DataStatistics')).not.toBeInTheDocument();
  });
});

// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UserAvatar from './index';

const mocks = vi.hoisted(() => ({
  communityWorkspaceProfile: {
    avatarUrl: null as string | null,
    isWorkspaceScope: true,
    username: 'workspace-market-namespace',
  },
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar, onClick }: { avatar?: string | null; onClick?: () => void }) => (
    <button data-avatar={avatar ?? ''} data-testid="community-user-avatar" onClick={onClick} />
  ),
  Button: ({ children }: { children?: string }) => <button>{children}</button>,
  Skeleton: {
    Avatar: () => <div data-testid="avatar-skeleton" />,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useCommunityWorkspaceProfile', () => ({
  useCommunityWorkspaceProfile: () => mocks.communityWorkspaceProfile,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  useMarketAuth: () => ({
    getCurrentUserInfo: () => ({ sub: 'current-user' }),
    isAuthenticated: true,
    isLoading: false,
    signIn: vi.fn(),
  }),
  useMarketUserProfile: () => ({
    data: { avatarUrl: 'user-avatar', namespace: 'personal-user', userName: 'personal-user' },
  }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { enableMarketTrustedClient: boolean }) => boolean) =>
    selector({ enableMarketTrustedClient: true }),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    enableMarketTrustedClient: (state: { enableMarketTrustedClient: boolean }) =>
      state.enableMarketTrustedClient,
  },
}));

describe('Community UserAvatar', () => {
  it('uses the provided avatar override before workspace fallback', () => {
    render(<UserAvatar avatarOverride={'🏢'} />);

    expect(screen.getByTestId('community-user-avatar')).toHaveAttribute('data-avatar', '🏢');
  });
});

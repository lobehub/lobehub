import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import Page from './index';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
});

const params = vi.hoisted(() => ({ value: {} as { sub?: string } }));

vi.mock('react-router', () => ({
  useParams: () => params.value,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/components/404', () => ({
  default: () => <div>not-found</div>,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { oauthApp: { create: { mutate: vi.fn() } } },
}));

vi.mock('@/features/Settings/features/SettingHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('./features/CreateAppModal', () => ({
  createOAuthAppModal: vi.fn(),
}));

vi.mock('./features/useOAuthAppList', () => ({
  useOAuthAppList: () => ({ data: undefined }),
}));

vi.mock('./features/AppDetail', () => ({
  AppDetailSkeleton: () => <div>app-detail-skeleton</div>,
}));

vi.mock('./features/AppListSkeleton', () => ({
  default: () => <div>app-list-skeleton</div>,
}));

vi.mock('./features/OAuthApps', () => ({
  default: () => <div>oauth-apps-page</div>,
}));

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  cleanup();
  params.value = {};
  useUserStore.setState(initialUserStoreState, true);
});

describe('OAuth Apps settings page', () => {
  it('returns not found when the Labs preference is disabled', () => {
    useUserStore.setState({ isUserStateInit: true });

    render(<Page />);

    expect(screen.getByText('not-found')).toBeDefined();
    expect(screen.queryByText('oauth-apps-page')).toBeNull();
  });

  it('renders OAuth app management when the Labs preference is enabled', () => {
    useUserStore.setState({
      isUserStateInit: true,
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    render(<Page />);

    expect(screen.getByText('tab.oauthApps')).toBeDefined();
    expect(screen.getByText('oauth-apps-page')).toBeDefined();
  });

  it('keeps the list skeleton under the header while preferences load', () => {
    render(<Page />);

    expect(screen.getByText('tab.oauthApps')).toBeDefined();
    expect(screen.getByText('app-list-skeleton')).toBeDefined();
  });

  // Regression: a direct visit to an app page showed only the header until
  // preferences loaded.
  it('shows the app page skeleton on a detail route while preferences load', () => {
    params.value = { sub: 'app_1' };

    render(<Page />);

    expect(screen.getByText('app-detail-skeleton')).toBeDefined();
    expect(screen.queryByText('app-list-skeleton')).toBeNull();
  });
});

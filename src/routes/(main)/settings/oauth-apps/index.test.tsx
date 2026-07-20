import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router', () => ({
  useParams: () => ({}),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => true,
}));

vi.mock('@/components/404', () => ({
  default: () => <div>not-found</div>,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { oauthApp: { create: { mutate: vi.fn() } } },
}));

vi.mock('@/routes/(main)/settings/features/SettingHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('./features/CreateAppModal', () => ({
  createOAuthAppModal: vi.fn(),
}));

vi.mock('./features/OAuthApps', () => ({
  default: () => <div>oauth-apps-page</div>,
}));

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  cleanup();
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
});

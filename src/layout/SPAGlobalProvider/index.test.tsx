/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type SPAGlobalProviderComponent from './index';

let SPAGlobalProvider: typeof SPAGlobalProviderComponent;

vi.mock('@lobehub/ui', async () => {
  const React = await import('react');
  const Passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ContextMenuHost: () => React.createElement('div', { 'data-testid': 'context-menu-host' }),
    ModalHost: () => React.createElement('div', { 'data-testid': 'legacy-modal-host' }),
    TooltipGroup: Passthrough,
  };
});

vi.mock('@lobehub/ui/base-ui', async () => {
  const React = await import('react');

  return {
    ModalHost: () => React.createElement('div', { 'data-testid': 'base-modal-host' }),
    ToastHost: () => React.createElement('div', { 'data-testid': 'toast-host' }),
  };
});

vi.mock('antd-style', async () => {
  const React = await import('react');

  return {
    StyleProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('motion/react', async () => {
  const React = await import('react');

  return {
    LazyMotion: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    domMax: {},
  };
});

vi.mock('@/components/Analytics/LobeAnalyticsProviderWrapper', async () => {
  const React = await import('react');

  return {
    LobeAnalyticsProviderWrapper: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/components/DragUploadZone/DragUploadProvider', async () => {
  const React = await import('react');

  return {
    DragUploadProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('@/features/DevDock', () => ({
  default: () => null,
}));

vi.mock('@/layout/AuthProvider', async () => {
  const React = await import('react');

  return {
    default: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/layout/AuthProvider/MarketAuth', async () => {
  const React = await import('react');

  return {
    MarketAuthProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'market-auth-provider' }, children),
  };
});

vi.mock('@/layout/GlobalProvider/AppTheme', async () => {
  const React = await import('react');

  return {
    default: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/layout/GlobalProvider/CacheHydrationGate', async () => {
  const React = await import('react');

  return {
    default: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/layout/GlobalProvider/DynamicFavicon', () => ({
  default: () => null,
}));

vi.mock('@/layout/GlobalProvider/FaviconProvider', async () => {
  const React = await import('react');

  return {
    FaviconProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/layout/GlobalProvider/GroupWizardProvider', async () => {
  const React = await import('react');

  return {
    GroupWizardProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/layout/GlobalProvider/Query', async () => {
  const React = await import('react');

  return {
    default: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/layout/GlobalProvider/ServerVersionOutdatedAlert', () => ({
  default: () => null,
}));

vi.mock('@/layout/GlobalProvider/StoreInitialization', () => ({
  default: () => null,
}));

vi.mock('@/store/serverConfig/Provider', async () => {
  const React = await import('react');

  return {
    ServerConfigStoreProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock('./Locale', async () => {
  const React = await import('react');

  return {
    default: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

describe('SPAGlobalProvider', () => {
  beforeAll(async () => {
    SPAGlobalProvider = (await import('./index')).default;
  });

  beforeEach(() => {
    vi.stubGlobal('__DEV__', false);
    Reflect.deleteProperty(window, '__SERVER_CONFIG__');
  });

  it('provides Market auth from the SPA global provider', () => {
    render(
      <SPAGlobalProvider>
        <div data-testid="spa-route-content" />
      </SPAGlobalProvider>,
    );

    const routeContent = screen.getByTestId('spa-route-content');

    expect(routeContent.closest('[data-testid="market-auth-provider"]')).not.toBeNull();
  });
});

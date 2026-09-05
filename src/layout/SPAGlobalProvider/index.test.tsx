/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPostRenderReady } from '@/spa/atoms/app';
import { setDevDockUnlocked } from '@/utils/devDockUnlock';

import type SPAGlobalProviderComponent from './index';
import { type DevDockLayout as DevDockLayoutComponent } from './index';

let SPAGlobalProvider: typeof SPAGlobalProviderComponent;
let DevDockLayout: typeof DevDockLayoutComponent;
const { cacheGateReleased, canAccessDevDock, devDockRenderError } = vi.hoisted(() => ({
  cacheGateReleased: { current: true },
  canAccessDevDock: vi.fn(() => false),
  devDockRenderError: { current: null as Error | null },
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const React = await import('react');

  return {
    ...(await importOriginal<object>()),
    ContextMenuHost: () => React.createElement('div', { 'data-testid': 'context-menu-host' }),
    ModalHost: () => React.createElement('div', { 'data-testid': 'legacy-modal-host' }),
    setContextMenuInterceptor: vi.fn(),
  };
});

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const React = await import('react');

  return {
    ...(await importOriginal<object>()),
    ModalHost: () => React.createElement('div', { 'data-testid': 'base-modal-host' }),
    ToastHost: () => React.createElement('div', { 'data-testid': 'toast-host' }),
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
  isDesktop: true,
}));

vi.mock('@/features/ProtocolUrlHandler', () => ({
  default: () => <div data-testid="protocol-url-handler" />,
}));

vi.mock('@/features/DevDock', async () => {
  const React = await import('react');

  return {
    default: () => {
      if (devDockRenderError.current) throw devDockRenderError.current;
      return React.createElement('div', { 'data-testid': 'dev-dock' });
    },
  };
});

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
      cacheGateReleased.current ? React.createElement(React.Fragment, null, children) : null,
  };
});

vi.mock('@/layout/GlobalProvider/DynamicFavicon', () => ({
  default: () => <div data-testid="dynamic-favicon" />,
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

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { canAccessDevDock: boolean }) => unknown) =>
    selector({ canAccessDevDock: canAccessDevDock() }),
}));

vi.mock('./Locale', async () => {
  const React = await import('react');

  return {
    default: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

describe('SPAGlobalProvider', () => {
  beforeAll(async () => {
    const loadedModule = await import('./index');
    SPAGlobalProvider = loadedModule.default;
    DevDockLayout = loadedModule.DevDockLayout;
  }, 30_000);

  beforeEach(() => {
    cacheGateReleased.current = true;
    canAccessDevDock.mockReturnValue(false);
    devDockRenderError.current = null;
    setDevDockUnlocked(false);
    Reflect.deleteProperty(window, '__SERVER_CONFIG__');
    setPostRenderReady(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('mounts desktop protocol handling before route cache hydration completes', () => {
    cacheGateReleased.current = false;

    render(
      <SPAGlobalProvider>
        <div data-testid="spa-route-content" />
      </SPAGlobalProvider>,
    );

    expect(screen.getByTestId('protocol-url-handler')).toBeInTheDocument();
    expect(screen.queryByTestId('spa-route-content')).not.toBeInTheDocument();
  });
  it('mounts DevDock in dev builds even without server-resolved access', async () => {
    render(
      <DevDockLayout>
        <div data-testid="spa-route-content" />
      </DevDockLayout>,
    );

    expect(await screen.findByTestId('dev-dock')).toBeInTheDocument();
  });

  it('does not mount DevDock in production without an unlock', () => {
    vi.stubEnv('PROD', true);
    canAccessDevDock.mockReturnValue(true);

    render(
      <DevDockLayout>
        <div data-testid="spa-route-content" />
      </DevDockLayout>,
    );

    expect(screen.queryByTestId('dev-dock')).toBeNull();
  });

  it('does not mount DevDock in production without server access', () => {
    vi.stubEnv('PROD', true);
    setDevDockUnlocked(true);

    render(
      <DevDockLayout>
        <div data-testid="spa-route-content" />
      </DevDockLayout>,
    );

    expect(screen.queryByTestId('dev-dock')).toBeNull();
  });

  it('mounts DevDock in production with server access and an unlock', async () => {
    vi.stubEnv('PROD', true);
    canAccessDevDock.mockReturnValue(true);
    setDevDockUnlocked(true);

    render(
      <DevDockLayout>
        <div data-testid="spa-route-content" />
      </DevDockLayout>,
    );

    expect(await screen.findByTestId('dev-dock')).toBeInTheDocument();
  });

  it('keeps the app alive when DevDock fails to load', async () => {
    vi.stubEnv('PROD', true);
    canAccessDevDock.mockReturnValue(true);
    setDevDockUnlocked(true);
    devDockRenderError.current = new TypeError(
      "Cannot read properties of undefined (reading 'default')",
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <DevDockLayout>
        <div data-testid="spa-route-content" />
      </DevDockLayout>,
    );

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.getByTestId('spa-route-content')).toBeInTheDocument();
    expect(screen.queryByTestId('dev-dock')).toBeNull();
    consoleError.mockRestore();
  });

  it('does not remount application providers when DevDock becomes available', async () => {
    vi.stubEnv('PROD', true);
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const ProviderProbe = () => {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <div data-testid="provider-probe" />;
    };

    const view = render(
      <DevDockLayout>
        <ProviderProbe />
      </DevDockLayout>,
    );
    expect(mounted).toHaveBeenCalledOnce();

    canAccessDevDock.mockReturnValue(true);
    setDevDockUnlocked(true);
    view.rerender(
      <DevDockLayout>
        <ProviderProbe />
      </DevDockLayout>,
    );

    expect(await screen.findByTestId('dev-dock')).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it('mounts global interaction hosts with the application shell', () => {
    render(
      <SPAGlobalProvider>
        <div />
      </SPAGlobalProvider>,
    );

    expect(screen.getByTestId('legacy-modal-host')).toBeInTheDocument();
    expect(screen.getByTestId('base-modal-host')).toBeInTheDocument();
    expect(screen.getByTestId('toast-host')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-host')).toBeInTheDocument();
  });

  it('does not mount the chat-store favicon subscriber before post-render initialization', () => {
    render(
      <SPAGlobalProvider>
        <div />
      </SPAGlobalProvider>,
    );

    expect(screen.queryByTestId('dynamic-favicon')).not.toBeInTheDocument();
  });
});

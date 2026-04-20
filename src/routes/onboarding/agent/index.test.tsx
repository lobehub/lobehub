import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RenderAgentRouteOptions {
  desktop?: boolean;
  enabled: boolean;
  serverConfigInit?: boolean;
}

const renderAgentRoute = async ({
  desktop = false,
  enabled,
  serverConfigInit = true,
}: RenderAgentRouteOptions) => {
  vi.resetModules();
  vi.doMock('@lobechat/const', () => ({
    isDesktop: desktop,
  }));
  vi.doMock('@/components/Loading/BrandTextLoading', () => ({
    default: ({ debugId }: { debugId: string }) => <div>{debugId}</div>,
  }));
  vi.doMock('@/features/Onboarding/Agent', () => ({
    default: () => <div>Agent onboarding</div>,
  }));
  function selectFromServerConfigStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector({
      featureFlags: { enableAgentOnboarding: enabled },
      serverConfigInit,
    });
  }

  vi.doMock('@/store/serverConfig', () => ({
    useServerConfigStore: selectFromServerConfigStore,
  }));

  const { default: AgentOnboardingRoute } = await import('./index');

  render(
    <MemoryRouter initialEntries={['/onboarding/agent']}>
      <Routes>
        <Route element={<AgentOnboardingRoute />} path="/onboarding/agent" />
        <Route element={<div>Classic onboarding</div>} path="/onboarding/classic" />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@/components/Loading/BrandTextLoading');
  vi.doUnmock('@/features/Onboarding/Agent');
  vi.doUnmock('@/store/serverConfig');
});

describe('AgentOnboardingRoute', () => {
  it('renders the agent onboarding page when the feature is enabled', async () => {
    await renderAgentRoute({ enabled: true });

    expect(screen.getByText('Agent onboarding')).toBeInTheDocument();
  });

  it('shows a loading state before the server config is initialized', async () => {
    await renderAgentRoute({ enabled: true, serverConfigInit: false });

    expect(screen.getByText('AgentOnboardingRoute')).toBeInTheDocument();
  });

  it('redirects to classic onboarding when the feature is disabled', async () => {
    await renderAgentRoute({ enabled: false });

    expect(screen.getByText('Classic onboarding')).toBeInTheDocument();
  });

  it('redirects to classic onboarding on desktop builds', async () => {
    await renderAgentRoute({ desktop: true, enabled: true });

    expect(screen.getByText('Classic onboarding')).toBeInTheDocument();
  });
});

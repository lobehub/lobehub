import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RenderAgentRouteOptions {
  AGENT_ONBOARDING_ENABLED?: boolean;
  commonStepsCompleted?: boolean;
  desktop?: boolean;
  enabled: boolean;
  isUserStateInit?: boolean;
  serverConfigInit?: boolean;
}

const renderAgentRoute = async ({
  AGENT_ONBOARDING_ENABLED = true,
  commonStepsCompleted = true,
  desktop = false,
  enabled,
  isUserStateInit = true,
  serverConfigInit = true,
}: RenderAgentRouteOptions) => {
  vi.resetModules();
  vi.doMock('@lobechat/business-const', () => ({
    AGENT_ONBOARDING_ENABLED,
  }));
  vi.doMock('@lobechat/const', () => ({
    isDesktop: desktop,
  }));
  vi.doMock('@/components/Loading/BrandTextLoading', () => ({
    default: ({ debugId }: { debugId: string }) => <div>{debugId}</div>,
  }));
  vi.doMock('@/features/Onboarding/Agent', () => ({
    default: () => <div>Agent onboarding</div>,
  }));
  const serverConfigState = {
    featureFlags: { enableAgentOnboarding: enabled },
    serverConfigInit,
  };
  function selectFromServerConfigStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector(serverConfigState);
  }

  vi.doMock('@/store/serverConfig', () => ({
    useServerConfigStore: selectFromServerConfigStore,
  }));

  const userState = { isUserStateInit, settings: {} };
  function selectFromUserStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector(userState);
  }

  vi.doMock('@/store/user', () => ({
    useUserStore: selectFromUserStore,
  }));
  vi.doMock('@/store/user/selectors', () => ({
    onboardingSelectors: {
      commonStepsCompleted: () => commonStepsCompleted,
    },
  }));

  const { default: AgentOnboardingRoute } = await import('./index');

  render(
    <MemoryRouter initialEntries={['/onboarding/agent']}>
      <Routes>
        <Route element={<AgentOnboardingRoute />} path="/onboarding/agent" />
        <Route element={<div>Classic onboarding</div>} path="/onboarding/classic" />
        <Route element={<div>Common onboarding</div>} path="/onboarding" />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.doUnmock('@lobechat/business-const');
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@/components/Loading/BrandTextLoading');
  vi.doUnmock('@/features/Onboarding/Agent');
  vi.doUnmock('@/store/serverConfig');
  vi.doUnmock('@/store/user');
  vi.doUnmock('@/store/user/selectors');
});

describe('AgentOnboardingRoute', () => {
  it('renders the agent onboarding page when the feature is enabled', async () => {
    await renderAgentRoute({ enabled: true });

    await waitFor(() => expect(screen.getByText('Agent onboarding')).toBeInTheDocument());
  });

  it('shows a loading state before the server config is initialized', async () => {
    await renderAgentRoute({ enabled: true, serverConfigInit: false });

    expect(screen.getByText('AgentOnboardingRoute')).toBeInTheDocument();
  });

  it('shows a loading state before the user state is initialized', async () => {
    await renderAgentRoute({ enabled: true, isUserStateInit: false });

    expect(screen.getByText('AgentOnboardingRoute')).toBeInTheDocument();
  });

  it('redirects to classic onboarding when the feature is disabled', async () => {
    await renderAgentRoute({ enabled: false });

    await waitFor(() => expect(screen.getByText('Classic onboarding')).toBeInTheDocument());
  });

  it('redirects to classic onboarding on desktop builds', async () => {
    await renderAgentRoute({ desktop: true, enabled: true });

    expect(screen.getByText('Classic onboarding')).toBeInTheDocument();
  });

  it('redirects to /onboarding when the shared prefix is incomplete', async () => {
    await renderAgentRoute({ commonStepsCompleted: false, enabled: true });

    await waitFor(() => expect(screen.getByText('Common onboarding')).toBeInTheDocument());
  });

  it('redirects to /onboarding instead of classic when shared prefix is incomplete even if the runtime flag is off', async () => {
    await renderAgentRoute({ commonStepsCompleted: false, enabled: false });

    await waitFor(() => expect(screen.getByText('Common onboarding')).toBeInTheDocument());
    expect(screen.queryByText('Classic onboarding')).not.toBeInTheDocument();
  });

  it('redirects to classic when AGENT_ONBOARDING_ENABLED master switch is off', async () => {
    await renderAgentRoute({ AGENT_ONBOARDING_ENABLED: false, enabled: true });

    expect(screen.getByText('Classic onboarding')).toBeInTheDocument();
  });
});

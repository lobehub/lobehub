import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RenderOptions {
  commonStepsCompleted: boolean;
  desktop?: boolean;
  enableAgentOnboarding?: boolean;
  isUserStateInit?: boolean;
  serverConfigInit?: boolean;
}

const renderCommon = async ({
  commonStepsCompleted,
  desktop = false,
  enableAgentOnboarding = true,
  isUserStateInit = true,
  serverConfigInit = true,
}: RenderOptions) => {
  cleanup();
  vi.resetModules();

  vi.doMock('@lobechat/const', () => ({ isDesktop: desktop }));
  vi.doMock('@/components/Loading/BrandTextLoading', () => ({
    default: ({ debugId }: { debugId: string }) => <div>Loading:{debugId}</div>,
  }));
  vi.doMock('@/routes/onboarding/_layout', () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }));
  vi.doMock('@/routes/onboarding/features/TelemetryStep', () => ({
    default: () => <div>TelemetryStep</div>,
  }));
  vi.doMock('@/routes/onboarding/features/ResponseLanguageStep', () => ({
    default: () => <div>ResponseLanguageStep</div>,
  }));

  function selectFromServerConfigStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector({
      featureFlags: { enableAgentOnboarding },
      serverConfigInit,
    });
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

  const { default: CommonOnboardingPage } = await import('./index');

  render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Routes>
        <Route element={<CommonOnboardingPage />} path="/onboarding" />
        <Route element={<div>Agent onboarding</div>} path="/onboarding/agent" />
        <Route element={<div>Classic onboarding</div>} path="/onboarding/classic" />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@/components/Loading/BrandTextLoading');
  vi.doUnmock('@/routes/onboarding/_layout');
  vi.doUnmock('@/routes/onboarding/features/TelemetryStep');
  vi.doUnmock('@/routes/onboarding/features/ResponseLanguageStep');
  vi.doUnmock('@/store/serverConfig');
  vi.doUnmock('@/store/user');
  vi.doUnmock('@/store/user/selectors');
});

describe('CommonOnboardingPage', () => {
  it('renders TelemetryStep (welcome + privacy) when shared prefix is incomplete', async () => {
    await renderCommon({ commonStepsCompleted: false });
    expect(screen.getByText('TelemetryStep')).toBeInTheDocument();
  });

  it('redirects to /onboarding/agent when shared prefix is complete and agent flag is on', async () => {
    await renderCommon({ commonStepsCompleted: true, enableAgentOnboarding: true });
    expect(screen.getByText('Agent onboarding')).toBeInTheDocument();
  });

  it('redirects to /onboarding/classic when shared prefix is complete and agent flag is off', async () => {
    await renderCommon({ commonStepsCompleted: true, enableAgentOnboarding: false });
    expect(screen.getByText('Classic onboarding')).toBeInTheDocument();
  });

  it('redirects to /onboarding/classic on desktop even when agent flag is on', async () => {
    await renderCommon({
      commonStepsCompleted: true,
      desktop: true,
      enableAgentOnboarding: true,
    });
    expect(screen.getByText('Classic onboarding')).toBeInTheDocument();
  });

  it('shows loading until user state initializes', async () => {
    await renderCommon({ commonStepsCompleted: false, isUserStateInit: false });
    expect(screen.getByText('Loading:CommonOnboarding/userState')).toBeInTheDocument();
  });

  it('shows loading until server config initializes when ready to redirect', async () => {
    await renderCommon({ commonStepsCompleted: true, serverConfigInit: false });
    expect(screen.getByText('Loading:CommonOnboarding/serverConfig')).toBeInTheDocument();
  });
});

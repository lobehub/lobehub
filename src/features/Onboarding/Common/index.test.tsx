import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RenderOptions {
  AGENT_ONBOARDING_ENABLED?: boolean;
  commonStepsCompleted: boolean;
  desktop?: boolean;
  enableAgentOnboarding?: boolean;
  finishedAt?: string;
  isUserStateInit?: boolean;
  persistedStep?: number;
  serverConfigInit?: boolean;
  setOnboardingStep?: ReturnType<typeof vi.fn>;
}

const renderCommon = async ({
  AGENT_ONBOARDING_ENABLED = true,
  commonStepsCompleted,
  desktop = false,
  enableAgentOnboarding = true,
  finishedAt,
  isUserStateInit = true,
  persistedStep,
  serverConfigInit = true,
  setOnboardingStep = vi.fn(),
}: RenderOptions) => {
  cleanup();
  vi.resetModules();

  vi.doMock('@lobechat/business-const', () => ({
    AGENT_ONBOARDING_ENABLED,
  }));
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

  const onboarding =
    persistedStep === undefined && finishedAt === undefined
      ? undefined
      : { currentStep: persistedStep, finishedAt };
  const userState = { isUserStateInit, onboarding, setOnboardingStep, settings: {} };
  function selectFromUserStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector(userState);
  }
  selectFromUserStore.getState = () => userState;
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
  vi.doUnmock('@lobechat/business-const');
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

  it('redirects to /onboarding/classic when AGENT_ONBOARDING_ENABLED master switch is off', async () => {
    await renderCommon({
      AGENT_ONBOARDING_ENABLED: false,
      commonStepsCompleted: true,
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

  describe('legacy classic step migration', () => {
    it('remaps legacy step 2 (old FullName) to new step 1', async () => {
      const setOnboardingStep = vi.fn();
      await renderCommon({ commonStepsCompleted: false, persistedStep: 2, setOnboardingStep });
      await waitFor(() => expect(setOnboardingStep).toHaveBeenCalledWith(1));
    });

    it('remaps legacy step 3 (old Interests) to new step 2', async () => {
      const setOnboardingStep = vi.fn();
      await renderCommon({ commonStepsCompleted: false, persistedStep: 3, setOnboardingStep });
      await waitFor(() => expect(setOnboardingStep).toHaveBeenCalledWith(2));
    });

    it('remaps legacy step 4+ (old Language/ProSettings) to MAX', async () => {
      const setOnboardingStep = vi.fn();
      await renderCommon({ commonStepsCompleted: false, persistedStep: 5, setOnboardingStep });
      await waitFor(() => expect(setOnboardingStep).toHaveBeenCalledWith(3));
    });

    it('does not write when step is already within new schema (idempotent)', async () => {
      const setOnboardingStep = vi.fn();
      await renderCommon({ commonStepsCompleted: false, persistedStep: 1, setOnboardingStep });
      // Allow effect to flush
      await new Promise((r) => setTimeout(r, 0));
      expect(setOnboardingStep).not.toHaveBeenCalled();
    });

    it('skips remap when onboarding is already finished', async () => {
      const setOnboardingStep = vi.fn();
      await renderCommon({
        commonStepsCompleted: true,
        finishedAt: '2024-01-01T00:00:00Z',
        persistedStep: 5,
        setOnboardingStep,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(setOnboardingStep).not.toHaveBeenCalled();
    });

    it('skips remap when user state is not yet initialized', async () => {
      const setOnboardingStep = vi.fn();
      await renderCommon({
        commonStepsCompleted: false,
        isUserStateInit: false,
        persistedStep: 2,
        setOnboardingStep,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(setOnboardingStep).not.toHaveBeenCalled();
    });
  });
});

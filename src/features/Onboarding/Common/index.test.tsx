import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const metrics = {
  trackOnboardingStepCompleted: vi.fn(),
  trackOnboardingStepViewed: vi.fn(),
};

interface RenderOptions {
  AGENT_ONBOARDING_ENABLED?: boolean;
  commonStepsCompleted: boolean;
  desktop?: boolean;
  enableAgentOnboarding?: boolean;
  finishedAt?: string;
  initialEntry?: string;
  isUserStateInit?: boolean;
  persistedStep?: number;
  serverConfigInit?: boolean;
  setOnboardingStep?: ReturnType<typeof vi.fn>;
}

const BranchPage = ({ label, testId }: { label: string; testId: string }) => {
  const location = useLocation();

  return (
    <div>
      <span>{label}</span>
      <span data-testid={testId}>
        {location.pathname}
        {location.search}
      </span>
    </div>
  );
};

const renderCommon = async ({
  AGENT_ONBOARDING_ENABLED = true,
  commonStepsCompleted,
  desktop = false,
  enableAgentOnboarding = true,
  finishedAt,
  initialEntry = '/onboarding',
  isUserStateInit = true,
  persistedStep,
  serverConfigInit = true,
  setOnboardingStep = vi.fn(),
}: RenderOptions) => {
  cleanup();
  vi.resetModules();
  metrics.trackOnboardingStepCompleted.mockClear();
  metrics.trackOnboardingStepViewed.mockClear();

  vi.doMock('@lobechat/business-const', () => ({
    AGENT_ONBOARDING_ENABLED,
  }));
  vi.doMock('@lobechat/const', () => ({ isDesktop: desktop }));
  vi.doMock('@lobehub/ui', () => ({
    Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }));
  vi.doMock('@/components/Loading/BrandTextLoading', () => ({
    default: ({ debugId }: { debugId: string }) => <div>Loading:{debugId}</div>,
  }));
  vi.doMock('@/hooks/useOnboardingAgentTemplates', () => ({
    useOnboardingAgentTemplates: vi.fn(),
  }));
  vi.doMock('@/routes/onboarding/_layout', () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }));
  vi.doMock('@/routes/onboarding/features/TelemetryStep', () => ({
    default: ({ onNext }: { onNext: () => void }) => (
      <div>
        TelemetryStep
        <button type="button" onClick={onNext}>
          telemetry-next
        </button>
      </div>
    ),
  }));
  vi.doMock('@/routes/onboarding/features/ResponseLanguageStep', () => ({
    default: ({ onBack, onNext }: { onBack: () => void; onNext: () => void }) => (
      <div>
        ResponseLanguageStep
        <button type="button" onClick={onBack}>
          rl-back
        </button>
        <button type="button" onClick={onNext}>
          rl-next
        </button>
      </div>
    ),
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
  vi.doMock('@/services/onboardingMetrics', () => metrics);

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
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<CommonOnboardingPage />} path="/onboarding" />
        <Route
          element={<BranchPage label="Agent onboarding" testId="agent-branch-location" />}
          path="/onboarding/agent"
        />
        <Route
          element={<BranchPage label="Classic onboarding" testId="classic-branch-location" />}
          path="/onboarding/classic"
        />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.doUnmock('@lobechat/business-const');
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@lobehub/ui');
  vi.doUnmock('@/components/Loading/BrandTextLoading');
  vi.doUnmock('@/hooks/useOnboardingAgentTemplates');
  vi.doUnmock('@/routes/onboarding/_layout');
  vi.doUnmock('@/routes/onboarding/features/TelemetryStep');
  vi.doUnmock('@/routes/onboarding/features/ResponseLanguageStep');
  vi.doUnmock('@/services/onboardingMetrics');
  vi.doUnmock('@/store/serverConfig');
  vi.doUnmock('@/store/user');
  vi.doUnmock('@/store/user/selectors');
});

describe('CommonOnboardingPage', () => {
  it('renders TelemetryStep (welcome + privacy) when shared prefix is incomplete', async () => {
    await renderCommon({ commonStepsCompleted: false });
    expect(screen.getByText('TelemetryStep')).toBeInTheDocument();
  });

  it('tracks the Telemetry step view when shared prefix starts', async () => {
    await renderCommon({ commonStepsCompleted: false });
    await waitFor(() =>
      expect(metrics.trackOnboardingStepViewed).toHaveBeenCalledWith({
        flow: 'common',
        step: 'telemetry',
        stepIndex: 1,
      }),
    );
  });

  it('tracks the Telemetry step completion before moving to ResponseLanguage', async () => {
    await renderCommon({ commonStepsCompleted: false });

    fireEvent.click(screen.getByText('telemetry-next'));

    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      flow: 'common',
      step: 'telemetry',
      stepIndex: 1,
    });
    expect(await screen.findByText('ResponseLanguageStep')).toBeInTheDocument();
  });

  it('redirects to /onboarding/agent when shared prefix is complete and agent flag is on', async () => {
    await renderCommon({ commonStepsCompleted: true, enableAgentOnboarding: true });
    expect(screen.getByText('Agent onboarding')).toBeInTheDocument();
  });

  it('threads callbackUrl when redirecting to the agent branch', async () => {
    await renderCommon({
      commonStepsCompleted: true,
      enableAgentOnboarding: true,
      initialEntry: '/onboarding?callbackUrl=%2Fsettings%3Ftab%3Dprofile',
    });

    expect(screen.getByTestId('agent-branch-location')).toHaveTextContent(
      '/onboarding/agent?callbackUrl=%2Fsettings%3Ftab%3Dprofile',
    );
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

  describe('shared-prefix re-entry', () => {
    it('renders ResponseLanguageStep instead of redirecting when ?step=2 and prefix is complete', async () => {
      await renderCommon({ commonStepsCompleted: true, initialEntry: '/onboarding?step=2' });
      expect(screen.getByText('ResponseLanguageStep')).toBeInTheDocument();
    });

    it('tracks the ResponseLanguage step view when revisiting ?step=2', async () => {
      await renderCommon({ commonStepsCompleted: true, initialEntry: '/onboarding?step=2' });
      await waitFor(() =>
        expect(metrics.trackOnboardingStepViewed).toHaveBeenCalledWith({
          flow: 'common',
          step: 'response_language',
          stepIndex: 2,
        }),
      );
    });

    it('renders TelemetryStep when ?step=1 and prefix is complete', async () => {
      await renderCommon({ commonStepsCompleted: true, initialEntry: '/onboarding?step=1' });
      expect(screen.getByText('TelemetryStep')).toBeInTheDocument();
    });

    it('goes back to TelemetryStep from a revisited ResponseLanguageStep', async () => {
      await renderCommon({ commonStepsCompleted: true, initialEntry: '/onboarding?step=2' });
      fireEvent.click(screen.getByText('rl-back'));
      expect(await screen.findByText('TelemetryStep')).toBeInTheDocument();
    });

    it('redirects into the branch when finishing a revisited ResponseLanguageStep', async () => {
      await renderCommon({
        commonStepsCompleted: true,
        enableAgentOnboarding: false,
        initialEntry: '/onboarding?step=2',
      });
      fireEvent.click(screen.getByText('rl-next'));
      expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
        flow: 'common',
        step: 'response_language',
        stepIndex: 2,
      });
      expect(await screen.findByText('Classic onboarding')).toBeInTheDocument();
    });
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

    it('remaps legacy step 4+ (old Language/ProSettings) to the ProSettings step', async () => {
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

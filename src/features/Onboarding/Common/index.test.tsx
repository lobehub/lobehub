import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CommonOnboardingPage from './index';

const mockState = vi.hoisted(() => {
  const metrics = {
    trackOnboardingStepCompleted: vi.fn(),
    trackOnboardingStepViewed: vi.fn(),
  };

  return {
    AGENT_ONBOARDING_ENABLED: true,
    commonStepsCompleted: false,
    desktop: false,
    enableAgentOnboarding: true,
    metrics,
    serverConfigInit: true,
    userState: {
      isUserStateInit: true,
      onboarding: undefined as { currentStep?: number; finishedAt?: string } | undefined,
      setOnboardingStep: vi.fn(),
      settings: {},
    },
  };
});

const metrics = mockState.metrics;

vi.mock('@lobechat/business-const', () => ({
  get AGENT_ONBOARDING_ENABLED() {
    return mockState.AGENT_ONBOARDING_ENABLED;
  },
  BRANDING_LOGO_URL: '',
  BRANDING_NAME: 'LobeHub',
  DEFAULT_EMBEDDING_PROVIDER: 'openai',
  DEFAULT_MINI_MODEL: 'gpt-4o-mini',
  DEFAULT_MINI_PROVIDER: 'openai',
  DEFAULT_MODEL: 'gpt-4o',
  DEFAULT_PROVIDER: 'openai',
  ORG_NAME: 'LobeHub',
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return mockState.desktop;
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: ({ debugId }: { debugId: string }) => <div>Loading:{debugId}</div>,
}));

vi.mock('@/hooks/useOnboardingAgentTemplates', () => ({
  useOnboardingAgentTemplates: vi.fn(),
}));

vi.mock('@/routes/onboarding/_layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/routes/onboarding/features/TelemetryStep', () => ({
  default: ({ onNext }: { onNext: () => void }) => (
    <div>
      TelemetryStep
      <button type="button" onClick={onNext}>
        telemetry-next
      </button>
    </div>
  ),
}));

vi.mock('@/routes/onboarding/features/ResponseLanguageStep', () => ({
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

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      featureFlags: { enableAgentOnboarding: mockState.enableAgentOnboarding },
      serverConfigInit: mockState.serverConfigInit,
    }),
}));

vi.mock('@/services/onboardingMetrics', () => mockState.metrics);

vi.mock('@/store/user', () => ({
  useUserStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mockState.userState),
    { getState: () => mockState.userState },
  ),
}));

vi.mock('@/store/user/selectors', () => ({
  onboardingSelectors: {
    commonStepsCompleted: () => mockState.commonStepsCompleted,
  },
}));

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
  vi.useRealTimers();
  metrics.trackOnboardingStepCompleted.mockClear();
  metrics.trackOnboardingStepViewed.mockClear();

  const onboarding =
    persistedStep === undefined && finishedAt === undefined
      ? undefined
      : { currentStep: persistedStep, finishedAt };
  mockState.AGENT_ONBOARDING_ENABLED = AGENT_ONBOARDING_ENABLED;
  mockState.commonStepsCompleted = commonStepsCompleted;
  mockState.desktop = desktop;
  mockState.enableAgentOnboarding = enableAgentOnboarding;
  mockState.serverConfigInit = serverConfigInit;
  mockState.userState = { isUserStateInit, onboarding, setOnboardingStep, settings: {} };

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<CommonOnboardingPage />} path="/onboarding" />
        <Route element={<div>Agent onboarding</div>} path="/onboarding/agent" />
        <Route element={<div>Classic onboarding</div>} path="/onboarding/classic" />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('CommonOnboardingPage', { timeout: 15_000 }, () => {
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

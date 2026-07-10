import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ClassicOnboardingPage from './index';

const metrics = vi.hoisted(() => ({
  trackOnboardingStepCompleted: vi.fn(),
  trackOnboardingStepViewed: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  commonStepsCompleted: true,
  currentStep: 1,
  enableComposio: true,
  goToNextStep: vi.fn(),
  goToPreviousStep: vi.fn(),
  isUserStateInit: true,
  serverConfigInit: true,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: ({ debugId }: { debugId: string }) => <div>Loading:{debugId}</div>,
}));

vi.mock('@/features/Onboarding/components/ModeSwitch', () => ({
  default: () => <div>ModeSwitch</div>,
}));

vi.mock('@/hooks/useOnboardingAgentTemplates', () => ({
  useOnboardingAgentTemplates: vi.fn(),
}));

vi.mock('@/routes/onboarding/_layout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/routes/onboarding/features/AgentPickerStep', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div>
      AgentPickerStep
      <button type="button" onClick={onBack}>
        agent-back
      </button>
    </div>
  ),
}));

vi.mock('@/routes/onboarding/features/FullNameStep', () => ({
  default: ({ onBack, onNext }: { onBack: () => void; onNext: () => void }) => (
    <div>
      FullNameStep
      <button type="button" onClick={onBack}>
        full-name-back
      </button>
      <button type="button" onClick={onNext}>
        full-name-next
      </button>
    </div>
  ),
}));

vi.mock('@/routes/onboarding/features/InterestsStep', () => ({
  default: ({ onBack, onNext }: { onBack: () => void; onNext: () => void }) => (
    <div>
      InterestsStep
      <button type="button" onClick={onBack}>
        interests-back
      </button>
      <button type="button" onClick={onNext}>
        interests-next
      </button>
    </div>
  ),
}));

vi.mock('@/routes/onboarding/features/ProSettingsStep', () => ({
  default: ({ onBack, onNext }: { onBack: () => void; onNext: () => void }) => (
    <div>
      ProSettingsStep
      <button type="button" onClick={onBack}>
        pro-back
      </button>
      <button type="button" onClick={onNext}>
        pro-next
      </button>
    </div>
  ),
}));

vi.mock('@/services/onboardingMetrics', () => ({
  trackOnboardingStepCompleted: metrics.trackOnboardingStepCompleted,
  trackOnboardingStepViewed: metrics.trackOnboardingStepViewed,
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableComposio: (s: { serverConfig: { enableComposio?: boolean } }) =>
      s.serverConfig.enableComposio || false,
  },
  useServerConfigStore: <T,>(
    selector: (state: {
      serverConfig: { enableComposio: boolean };
      serverConfigInit: boolean;
    }) => T,
  ) =>
    selector({
      serverConfig: { enableComposio: mocks.enableComposio },
      serverConfigInit: mocks.serverConfigInit,
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: <T,>(
    selector: (state: {
      commonStepsCompleted: boolean;
      currentStep: number;
      goToNextStep: () => void;
      goToPreviousStep: () => void;
      isUserStateInit: boolean;
    }) => T,
  ) =>
    selector({
      commonStepsCompleted: mocks.commonStepsCompleted,
      currentStep: mocks.currentStep,
      goToNextStep: mocks.goToNextStep,
      goToPreviousStep: mocks.goToPreviousStep,
      isUserStateInit: mocks.isUserStateInit,
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  onboardingSelectors: {
    commonStepsCompleted: (s: { commonStepsCompleted: boolean }) => s.commonStepsCompleted,
    currentStep: (s: { currentStep: number }) => s.currentStep,
  },
}));

const renderClassic = () =>
  render(
    <MemoryRouter initialEntries={['/onboarding/classic']}>
      <ClassicOnboardingPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.commonStepsCompleted = true;
  mocks.currentStep = 1;
  mocks.enableComposio = true;
  mocks.goToNextStep.mockReset();
  mocks.goToPreviousStep.mockReset();
  mocks.isUserStateInit = true;
  mocks.serverConfigInit = true;
  metrics.trackOnboardingStepCompleted.mockReset();
  metrics.trackOnboardingStepViewed.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ClassicOnboardingPage', () => {
  it('tracks the current classic step view', async () => {
    renderClassic();

    await waitFor(() =>
      expect(metrics.trackOnboardingStepViewed).toHaveBeenCalledWith({
        flow: 'classic',
        step: 'fullname',
        stepIndex: 1,
      }),
    );
  });

  it('tracks FullName completion before moving forward', () => {
    renderClassic();
    fireEvent.click(screen.getByText('full-name-next'));

    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      flow: 'classic',
      step: 'fullname',
      stepIndex: 1,
    });
    expect(mocks.goToNextStep).toHaveBeenCalledTimes(1);
  });

  it('skips ProSettings when moving forward from interests without Composio', () => {
    mocks.currentStep = 2;
    mocks.enableComposio = false;

    renderClassic();
    fireEvent.click(screen.getByText('interests-next'));

    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      flow: 'classic',
      skippedNextStep: 'prosettings',
      step: 'interests',
      stepIndex: 2,
    });
    expect(mocks.goToNextStep).toHaveBeenCalledTimes(2);
  });

  it('moves back from the agent picker to interests when ProSettings is skipped', () => {
    mocks.currentStep = MAX_ONBOARDING_STEPS;
    mocks.enableComposio = false;

    renderClassic();
    fireEvent.click(screen.getByText('agent-back'));

    expect(mocks.goToPreviousStep).toHaveBeenCalledTimes(2);
  });

  it('waits for server config before deciding whether to skip ProSettings', () => {
    mocks.currentStep = 2;
    mocks.enableComposio = false;
    mocks.serverConfigInit = false;

    renderClassic();
    fireEvent.click(screen.getByText('interests-next'));

    expect(mocks.goToNextStep).toHaveBeenCalled();
  });

  it('shows loading at ProSettings until server config initializes', () => {
    mocks.currentStep = 3;
    mocks.enableComposio = false;
    mocks.serverConfigInit = false;

    renderClassic();

    expect(screen.getByText('Loading:ClassicOnboarding/serverConfig')).toBeInTheDocument();
    expect(mocks.goToNextStep).not.toHaveBeenCalled();
  });

  it('skips a persisted ProSettings step when Composio is disabled', async () => {
    mocks.currentStep = 3;
    mocks.enableComposio = false;

    renderClassic();

    await waitFor(() => expect(mocks.goToNextStep).toHaveBeenCalledTimes(1));
    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      action: 'auto_skip',
      flow: 'classic',
      skipped: true,
      step: 'prosettings',
      stepIndex: 3,
    });
    expect(screen.queryByText('ProSettingsStep')).not.toBeInTheDocument();
  });

  it('does not skip while shared prefix steps are incomplete', async () => {
    mocks.commonStepsCompleted = false;
    mocks.currentStep = 3;
    mocks.enableComposio = false;

    renderClassic();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.goToNextStep).not.toHaveBeenCalled();
  });

  it('keeps ProSettings in the flow when Composio is enabled', () => {
    mocks.currentStep = 3;
    mocks.enableComposio = true;

    renderClassic();
    fireEvent.click(screen.getByText('pro-next'));

    expect(screen.getByText('ProSettingsStep')).toBeInTheDocument();
    expect(metrics.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      flow: 'classic',
      step: 'prosettings',
      stepIndex: 3,
    });
    expect(mocks.goToNextStep).toHaveBeenCalled();
  });
});

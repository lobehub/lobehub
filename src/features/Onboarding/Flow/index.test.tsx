import { OnboardingStep } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OnboardingFlowPage from './index';

const mocks = vi.hoisted(() => ({
  finish: vi.fn().mockResolvedValue(undefined),
  isResolving: false,
  stashOnboardingCallbackUrl: vi.fn(),
}));

vi.mock('./useOnboardingFlow', () => ({
  useOnboardingFlow: () => ({
    back: vi.fn(),
    currentStep: OnboardingStep.Welcome,
    finish: mocks.finish,
    hasPrevious: false,
    isLast: false,
    isResolving: mocks.isResolving,
    next: vi.fn(),
    visibleSteps: [OnboardingStep.Welcome],
  }),
}));

vi.mock('./steps/Welcome', () => ({ default: () => <div>Welcome Step</div> }));
vi.mock('./steps/ConnectApps', () => ({ default: () => <div>ConnectApps Step</div> }));
vi.mock('./steps/LearnYourWorld', () => ({ default: () => <div>LearnYourWorld Step</div> }));
vi.mock('./steps/Profile', () => ({ default: () => <div>Profile Step</div> }));
vi.mock('./steps/ChiefAgent', () => ({ default: () => <div>ChiefAgent Step</div> }));
vi.mock('./steps/Messenger', () => ({ default: () => <div>Messenger Step</div> }));
vi.mock('./steps/StarterTasks', () => ({ default: () => <div>StarterTasks Step</div> }));

vi.mock('@/features/User/UserPanel/LangButton', () => ({
  default: () => <div>Lang Button</div>,
}));

vi.mock('@/features/User/UserPanel/ThemeButton', () => ({
  default: () => <div>Theme Button</div>,
}));

vi.mock('@/hooks/useIsDark', () => ({
  useIsDark: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/utils/onboardingRedirect', () => ({
  consumeOnboardingCallbackUrl: () => undefined,
  stashOnboardingCallbackUrl: (search: string) => mocks.stashOnboardingCallbackUrl(search),
}));

const renderAt = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OnboardingFlowPage />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.isResolving = false;
});

describe('OnboardingFlowPage', () => {
  it('mounts the shared onboarding container around the current step', () => {
    renderAt('/onboarding');

    expect(screen.getByText('Lang Button')).toBeInTheDocument();
    expect(screen.getByText('Theme Button')).toBeInTheDocument();
    expect(screen.getByText('flow.skip')).toBeInTheDocument();
    expect(screen.getByText('Welcome Step')).toBeInTheDocument();
  });

  it('stashes the threaded callbackUrl on mount', () => {
    renderAt('/onboarding?callbackUrl=%2Fchat');

    expect(mocks.stashOnboardingCallbackUrl).toHaveBeenCalledWith('?callbackUrl=%2Fchat');
  });

  it('renders a loading state instead of a step while capabilities are still resolving', () => {
    mocks.isResolving = true;

    renderAt('/onboarding');

    expect(screen.queryByText('Welcome Step')).not.toBeInTheDocument();
  });

  it('fires finish with a skipped marker when the skip affordance is used', () => {
    renderAt('/onboarding');

    screen.getByText('flow.skip').click();

    expect(mocks.finish).toHaveBeenCalledWith({ skipped: true });
  });
});

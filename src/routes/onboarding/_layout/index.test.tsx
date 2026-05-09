import type * as BusinessConst from '@lobechat/business-const';
import type * as Const from '@lobechat/const';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OnBoardingContainer from './index';

const mocks = vi.hoisted(() => ({
  AGENT_ONBOARDING_ENABLED: true,
  enableAgentOnboarding: true as boolean | undefined,
  isDesktop: false,
  serverConfigInit: true,
}));

vi.mock('@lobechat/business-const', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof BusinessConst;
  return {
    ...actual,
    get AGENT_ONBOARDING_ENABLED() {
      return mocks.AGENT_ONBOARDING_ENABLED;
    },
  };
});

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof Const;
  return {
    ...actual,
    get isDesktop() {
      return mocks.isDesktop;
    },
  };
});

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
  Trans: ({ values }: { values?: { mode?: string; skip?: string } }) => {
    const modeText = values?.mode ?? '';
    const skipText = values?.skip ?? '';

    return `Not feeling it today? You can switch to ${modeText} or ${skipText}.`;
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      featureFlags: { enableAgentOnboarding: mocks.enableAgentOnboarding },
      serverConfigInit: mocks.serverConfigInit,
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ finishOnboarding: vi.fn() }),
}));

const renderAt = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OnBoardingContainer>
        <div>Onboarding Content</div>
      </OnBoardingContainer>
    </MemoryRouter>,
  );

const hasSkipFooter = () =>
  screen.queryByText((content) => content.includes('agent.layout.skip')) !== null;

beforeEach(() => {
  mocks.AGENT_ONBOARDING_ENABLED = true;
  mocks.enableAgentOnboarding = true;
  mocks.isDesktop = false;
  mocks.serverConfigInit = true;
});

afterEach(() => {
  cleanup();
});

describe('OnBoardingContainer', () => {
  it('renders onboarding content without footer on the shared-prefix /onboarding path', () => {
    renderAt('/onboarding');

    expect(screen.getByText('Lang Button')).toBeInTheDocument();
    expect(screen.getByText('Theme Button')).toBeInTheDocument();
    expect(screen.getByText('Onboarding Content')).toBeInTheDocument();
    expect(hasSkipFooter()).toBe(false);
  });

  it('shows skip-and-switch footer on /onboarding/agent when agent flow is reachable', () => {
    renderAt('/onboarding/agent');
    expect(hasSkipFooter()).toBe(true);
  });

  it('hides footer when AGENT_ONBOARDING_ENABLED master switch is off', () => {
    mocks.AGENT_ONBOARDING_ENABLED = false;
    renderAt('/onboarding/agent');
    expect(hasSkipFooter()).toBe(false);
  });

  it('hides footer on desktop, where agent flow is unreachable', () => {
    mocks.isDesktop = true;
    renderAt('/onboarding/agent');
    expect(hasSkipFooter()).toBe(false);
  });

  it('hides footer when runtime feature flag enableAgentOnboarding is off', () => {
    mocks.enableAgentOnboarding = false;
    renderAt('/onboarding/agent');
    expect(hasSkipFooter()).toBe(false);
  });

  it('hides footer until server config has initialized', () => {
    mocks.serverConfigInit = false;
    renderAt('/onboarding/agent');
    expect(hasSkipFooter()).toBe(false);
  });
});

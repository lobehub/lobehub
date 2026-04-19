import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ModeSwitch from './ModeSwitch';

const mockConfig = vi.hoisted(() => ({
  agentOnboardingEnabled: true,
  desktop: false,
  serverConfigInit: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'agent.modeSwitch.agent': 'Conversational',
          'agent.modeSwitch.classic': 'Classic',
          'agent.modeSwitch.label': 'Choose your onboarding mode',
        }) as Record<string, string>
      )[key] || key,
  }),
}));

interface RenderModeSwitchOptions {
  actions?: ReactNode;
  desktop?: boolean;
  enabled: boolean;
  entry?: string;
  serverConfigInit?: boolean;
  showLabel?: boolean;
}

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return mockConfig.desktop;
  },
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: <T,>(
    selector: (state: {
      featureFlags: {
        enableAgentOnboarding: boolean;
      };
      serverConfigInit: boolean;
    }) => T,
  ) => {
    return selector({
      featureFlags: { enableAgentOnboarding: mockConfig.agentOnboardingEnabled },
      serverConfigInit: mockConfig.serverConfigInit,
    });
  },
}));

const renderModeSwitch = ({
  actions,
  desktop = false,
  enabled,
  entry = '/onboarding/agent',
  serverConfigInit = true,
  showLabel,
}: RenderModeSwitchOptions) => {
  mockConfig.agentOnboardingEnabled = enabled;
  mockConfig.desktop = desktop;
  mockConfig.serverConfigInit = serverConfigInit;

  render(
    <MemoryRouter initialEntries={[entry]}>
      <ModeSwitch actions={actions} showLabel={showLabel} />
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  mockConfig.agentOnboardingEnabled = true;
  mockConfig.desktop = false;
  mockConfig.serverConfigInit = true;
});

// Each test does vi.resetModules() + dynamic import of the component, which
// re-parses antd + @lobehub/ui fresh. On cold CI runs this can blow past the
// default 5s timeout even though the test is doing nothing slow itself.
const TEST_TIMEOUT_MS = 15_000;

describe('ModeSwitch', () => {
  it('renders both onboarding variants when agent onboarding is enabled', () => {
    renderModeSwitch({ enabled: true, showLabel: true });

      expect(screen.getByText('Choose your onboarding mode')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Conversational' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Classic' })).not.toBeChecked();
    },
    TEST_TIMEOUT_MS,
  );

  it('hides the onboarding switch entirely when agent onboarding is disabled', () => {
    renderModeSwitch({ enabled: false });

      expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
      expect(screen.queryByText('Choose your onboarding mode')).not.toBeInTheDocument();
    },
    TEST_TIMEOUT_MS,
  );

  it('hides the onboarding switch until server config is initialized', () => {
    renderModeSwitch({ enabled: true, serverConfigInit: false });

    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
  });

  it('keeps action buttons visible when agent onboarding is disabled', () => {
    renderModeSwitch({
      actions: <button type="button">Restart</button>,
      enabled: false,
    });

    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
  });

  it('does not render the switch on desktop builds', () => {
    renderModeSwitch({ desktop: true, enabled: true });

    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
  });
});

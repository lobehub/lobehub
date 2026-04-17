import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ModeSwitch from './ModeSwitch';

const mockConfig = vi.hoisted(() => ({ agentOnboardingEnabled: true }));

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

vi.mock('@/routes/onboarding/config', () => ({
  get AGENT_ONBOARDING_ENABLED() {
    return mockConfig.agentOnboardingEnabled;
  },
}));

const renderModeSwitch = ({
  actions,
  enabled,
  entry = '/onboarding/agent',
  showLabel,
}: {
  actions?: ReactNode;
  enabled: boolean;
  entry?: string;
  showLabel?: boolean;
}) => {
  mockConfig.agentOnboardingEnabled = enabled;

  render(
    <MemoryRouter initialEntries={[entry]}>
      <ModeSwitch actions={actions} showLabel={showLabel} />
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  mockConfig.agentOnboardingEnabled = true;
});

describe('ModeSwitch', () => {
  it('renders both onboarding variants when agent onboarding is enabled', () => {
    renderModeSwitch({ enabled: true, showLabel: true });

    expect(screen.getByText('Choose your onboarding mode')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Conversational' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Classic' })).not.toBeChecked();
  });

  it('hides the onboarding switch entirely when agent onboarding is disabled', () => {
    renderModeSwitch({ enabled: false });

    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
    expect(screen.queryByText('Choose your onboarding mode')).not.toBeInTheDocument();
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
});

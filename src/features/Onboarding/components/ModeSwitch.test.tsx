import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.modeSwitch.agent': 'Conversational',
        'agent.modeSwitch.classic': 'Classic',
        'agent.modeSwitch.label': 'Choose your onboarding mode',
      })[key] || key,
  }),
}));

const renderModeSwitch = async ({
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
  vi.resetModules();
  vi.doMock('@/routes/onboarding/config', () => ({
    AGENT_ONBOARDING_ENABLED: enabled,
  }));

  const { default: ModeSwitch } = await import('./ModeSwitch');

  render(
    <MemoryRouter initialEntries={[entry]}>
      <ModeSwitch actions={actions} showLabel={showLabel} />
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.doUnmock('@/routes/onboarding/config');
});

// Each test does vi.resetModules() + dynamic import of the component, which
// re-parses antd + @lobehub/ui fresh. On cold CI runs this can blow past the
// default 5s timeout even though the test is doing nothing slow itself.
const TEST_TIMEOUT_MS = 15_000;

describe('ModeSwitch', () => {
  it(
    'renders both onboarding variants when agent onboarding is enabled',
    async () => {
      await renderModeSwitch({ enabled: true, showLabel: true });

      expect(screen.getByText('Choose your onboarding mode')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Conversational' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Classic' })).not.toBeChecked();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'hides the onboarding switch entirely when agent onboarding is disabled',
    async () => {
      await renderModeSwitch({ enabled: false });

      expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
      expect(screen.queryByText('Choose your onboarding mode')).not.toBeInTheDocument();
    },
    TEST_TIMEOUT_MS,
  );

  it('keeps action buttons visible when agent onboarding is disabled', async () => {
    await renderModeSwitch({
      actions: <button type="button">Restart</button>,
      enabled: false,
    });

    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
  });
});

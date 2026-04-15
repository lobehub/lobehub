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

interface RenderModeSwitchOptions {
  actions?: ReactNode;
  desktop?: boolean;
  enabled: boolean;
  entry?: string;
  serverConfigInit?: boolean;
  showLabel?: boolean;
}

const renderModeSwitch = async ({
  actions,
  desktop = false,
  enabled,
  entry = '/onboarding/agent',
  serverConfigInit = true,
  showLabel,
}: RenderModeSwitchOptions) => {
  vi.resetModules();
  vi.doMock('@lobechat/const', () => ({
    isDesktop: desktop,
  }));
  function selectFromServerConfigStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector({
      featureFlags: { enableAgentOnboarding: enabled },
      serverConfigInit,
    });
  }

  vi.doMock('@/store/serverConfig', () => ({
    useServerConfigStore: selectFromServerConfigStore,
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
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@/store/serverConfig');
});

describe('ModeSwitch', () => {
  it('renders both onboarding variants when agent onboarding is enabled', async () => {
    await renderModeSwitch({ enabled: true, showLabel: true });

    expect(screen.getByText('Choose your onboarding mode')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Conversational' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Classic' })).not.toBeChecked();
  });

  it('hides the onboarding switch entirely when agent onboarding is disabled', async () => {
    await renderModeSwitch({ enabled: false });

    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
    expect(screen.queryByText('Choose your onboarding mode')).not.toBeInTheDocument();
  });

  it('hides the onboarding switch until server config is initialized', async () => {
    await renderModeSwitch({ enabled: true, serverConfigInit: false });

    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
  });

  it('keeps action buttons visible when agent onboarding is disabled', async () => {
    await renderModeSwitch({
      actions: <button type="button">Restart</button>,
      enabled: false,
    });

    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
  });

  it('does not render the switch on desktop builds', async () => {
    await renderModeSwitch({ desktop: true, enabled: true });

    expect(screen.queryByRole('radio', { name: 'Conversational' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Classic' })).not.toBeInTheDocument();
  });
});

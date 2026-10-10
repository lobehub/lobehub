/**
 * @vitest-environment happy-dom
 *
 * The channel provider list is replica-backed: on a revisit the detail form
 * paints the persisted config first and the live fetch replaces it in the
 * background. Regression: that background replacement must not wipe the edits
 * the user started during it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import PlatformDetail from './index';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  navigate: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as { App: Record<string, unknown> } & Record<
    string,
    unknown
  >;

  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({
        message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
      }),
    },
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/services/agentBotProvider', () => ({
  agentBotProviderService: {
    getRuntimeStatus: vi.fn(async () => ({ status: 'connected' })),
    wechatGetQrCode: vi.fn(),
    wechatPollQrStatus: vi.fn(),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      connectBot: vi.fn(),
      createBotProvider: vi.fn(),
      deleteAllBotProviders: vi.fn(),
      deleteBotProvider: vi.fn(),
      refreshBotRuntimeStatus: vi.fn(),
      testConnection: vi.fn(),
      updateBotProvider: vi.fn(),
    }),
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.test',
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ActionIcon: ({
    'aria-label': ariaLabel,
    disabled,
    onClick,
    title,
  }: {
    'aria-label'?: string;
    'disabled'?: boolean;
    'onClick'?: () => void;
    'title'?: string;
  }) => (
    <button aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/components/FormInput', () => ({
  FormInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  FormPassword: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/InfoTooltip', () => ({
  default: ({ title }: { title?: string }) => (
    <span aria-hidden="true" data-testid="info-tooltip" title={title} />
  ),
}));

vi.mock('../const', () => ({
  getPlatformIcon: () => null,
}));

const platformDef = {
  documentation: {},
  id: 'discord',
  name: 'Discord',
  schema: [
    {
      key: 'applicationId',
      label: 'channel.applicationId',
      required: true,
      type: 'string',
    },
  ],
} as unknown as SerializedPlatformDefinition;

const persistedConfig = {
  applicationId: 'app-id',
  credentials: { botToken: '••••••' },
  enabled: true,
  id: 'provider-id',
  platform: 'discord',
  settings: { charLimit: 2000 },
};

/** A background revalidation: a fresh object for the same provider. */
const liveConfig = { ...persistedConfig, credentials: { botToken: '••••••' } };

const applicationIdInput = () => screen.getByRole('textbox', { name: 'channel.applicationId' });

describe('channel detail config resync', () => {
  it('keeps unsaved edits when the live fetch replaces the hydrated config', async () => {
    const { rerender } = render(
      <PlatformDetail
        agentId="agent-id"
        currentConfig={persistedConfig}
        platformDef={platformDef}
      />,
    );

    await waitFor(() => expect(applicationIdInput()).toHaveValue('app-id'));

    fireEvent.change(applicationIdInput(), { target: { value: 'edited-app-id' } });
    expect(applicationIdInput()).toHaveValue('edited-app-id');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'channel.discard' })).toBeInTheDocument(),
    );

    // The initial network revalidation lands with the server copy.
    rerender(
      <PlatformDetail agentId="agent-id" currentConfig={liveConfig} platformDef={platformDef} />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'channel.discard' })).toBeInTheDocument(),
    );
    expect(applicationIdInput()).toHaveValue('edited-app-id');
  });

  it('still adopts the fresh config when the form has no pending edits', async () => {
    const { rerender } = render(
      <PlatformDetail
        agentId="agent-id"
        currentConfig={persistedConfig}
        platformDef={platformDef}
      />,
    );

    await waitFor(() => expect(applicationIdInput()).toHaveValue('app-id'));

    rerender(
      <PlatformDetail
        agentId="agent-id"
        currentConfig={{ ...persistedConfig, applicationId: 'server-app-id' }}
        platformDef={platformDef}
      />,
    );

    await waitFor(() => expect(applicationIdInput()).toHaveValue('server-app-id'));
  });

  it('adopts a different provider even while the previous form was dirty', async () => {
    const { rerender } = render(
      <PlatformDetail
        agentId="agent-id"
        currentConfig={persistedConfig}
        platformDef={platformDef}
      />,
    );

    await waitFor(() => expect(applicationIdInput()).toHaveValue('app-id'));
    fireEvent.change(applicationIdInput(), { target: { value: 'edited-app-id' } });

    rerender(
      <PlatformDetail
        agentId="agent-id"
        platformDef={platformDef}
        currentConfig={{
          ...persistedConfig,
          applicationId: 'other-app-id',
          id: 'other-provider',
        }}
      />,
    );

    await waitFor(() => expect(applicationIdInput()).toHaveValue('other-app-id'));
  });
});

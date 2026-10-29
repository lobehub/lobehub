/**
 * @vitest-environment happy-dom
 */
import { useForm } from '@lobehub/ui/form';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import PlatformDetail, { type ChannelFormValues } from '@/features/AgentChannel/PlatformDetail';
import Body from '@/features/AgentChannel/PlatformDetail/Body';
import { FooterActions } from '@/features/AgentChannel/PlatformDetail/Footer';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import Header from './Header';

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

// The channel body reads released-behind flags from the server config store, which is a
// context store: without a provider it throws while rendering.
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: { featureFlags: Record<string, unknown> }) => unknown) =>
    selector({ featureFlags: {} }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/features/NavHeader', () => ({
  default: ({
    children,
    left,
    right,
  }: {
    children?: ReactNode;
    left?: ReactNode;
    right?: ReactNode;
  }) => (
    <header>
      {left}
      {children}
      {right}
    </header>
  ),
}));

vi.mock('@/features/AgentBreadcrumb', () => ({
  default: ({ extraItems, title }: { extraItems?: ReactNode[]; title?: ReactNode }) => (
    <nav>
      {title}
      {extraItems}
    </nav>
  ),
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
      // The channel form names quick-created bot apps after the agent.
      agentMap: {
        // A name (who the agent is) and a title (the role it plays) that differ.
        'agent-id': { name: 'Shadow Arvin', title: 'Simulated teammate' },
      },
      // The agent meta selector looks up the built-in agents for a default avatar.
      builtinAgentIdMap: {},
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

vi.mock('@lobehub/ui', async (importOriginal) => ({
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
  Alert: ({
    description,
    message,
    style,
    title,
  }: {
    description?: ReactNode;
    message?: ReactNode;
    style?: React.CSSProperties;
    title?: ReactNode;
  }) => (
    <div data-testid="channel-paid-alert" style={style}>
      <div data-testid="channel-paid-alert-title">{title || message}</div>
      <div data-testid="channel-paid-alert-description">{description}</div>
    </div>
  ),
  DropdownMenu: ({
    children,
    items,
  }: {
    children?: ReactNode;
    items?: { key?: string; label?: ReactNode }[];
  }) => (
    <div>
      {children}
      {items?.map((item, index) => (
        <span key={item.key ?? index}>{item.label}</span>
      ))}
    </div>
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

vi.mock('@/features/AgentChannel/const', () => ({
  getPlatformIcon: () => null,
}));

const platformDef = {
  documentation: {},
  id: 'discord',
  name: 'Discord',
  schema: [
    {
      description: 'channel.applicationIdHint',
      key: 'applicationId',
      label: 'channel.applicationId',
      required: true,
      type: 'string',
    },
    {
      key: 'credentials',
      label: 'channel.credentials',
      properties: [
        {
          key: 'botToken',
          label: 'channel.botToken',
          required: true,
          type: 'password',
        },
      ],
      type: 'object',
    },
    {
      key: 'settings',
      label: 'channel.settings',
      properties: [
        {
          default: 2000,
          key: 'charLimit',
          label: 'channel.charLimit',
          type: 'integer',
        },
        {
          key: 'userId',
          label: 'channel.userId',
          type: 'string',
        },
      ],
      type: 'object',
    },
  ],
} as SerializedPlatformDefinition;

const currentConfig = {
  applicationId: 'app-id',
  credentials: { botToken: 'token' },
  enabled: true,
  id: 'provider-id',
  platform: 'discord',
  settings: { charLimit: 2000 },
};

const BodyHarness = ({
  activeTab,
  disabled,
}: {
  activeTab: 'advanced' | 'connect';
  disabled?: boolean;
}) => {
  const form = useForm<ChannelFormValues>();

  return (
    <Body
      hasConfig
      activeTab={activeTab}
      currentConfig={currentConfig}
      disabled={disabled}
      form={form}
      platformDef={platformDef}
    />
  );
};

const FooterHarness = ({ disabled }: { disabled?: boolean }) => {
  const form = useForm<ChannelFormValues>();

  return (
    <FooterActions
      hasConfig
      isDirty
      connecting={false}
      disabled={disabled}
      form={form}
      platformDef={platformDef}
      saving={false}
      testing={false}
      writeDisabled={disabled}
      onCopied={vi.fn()}
      onDelete={vi.fn()}
      onDiscard={vi.fn()}
      onSave={vi.fn()}
      onTestConnection={vi.fn()}
    />
  );
};

const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

// A saved bot folds its credentials away; open them the way a person would.
const openCredentials = () => fireEvent.click(screen.getByText('channel.credentials'));

describe('Agent channel permission gates', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = null;
    mocks.navigate.mockClear();
  });

  it('renders channel credentials as read-only when editing is denied', () => {
    const { unmount } = render(<BodyHarness disabled activeTab="connect" />);

    openCredentials();
    expect(screen.getByRole('textbox', { name: /^channel.applicationId/ })).toBeDisabled();
    expect(screen.queryByTestId('info-tooltip')).not.toBeInTheDocument();
    expect(screen.getByLabelText('channel.botToken')).toBeDisabled();
    unmount();

    render(<BodyHarness disabled activeTab="advanced" />);

    expect(screen.getByRole('textbox', { name: /^channel.charLimit/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.settingsResetDefault' })).toBeDisabled();
  });

  it('shows one tab at a time and keeps the others mounted', () => {
    const { rerender } = render(<BodyHarness activeTab="advanced" />);

    expect(screen.getByRole('textbox', { name: /^channel.charLimit/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /^channel.applicationId/ }),
    ).not.toBeInTheDocument();
    // The hidden panel is still in the document, so its values survive a save.
    expect(document.querySelector('#channel-panel-connect')).toHaveAttribute('hidden');

    rerender(<BodyHarness activeTab="connect" />);

    openCredentials();
    expect(screen.getByRole('textbox', { name: /^channel.applicationId/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^channel.charLimit/ })).not.toBeInTheDocument();
  });

  it('disables mutating channel actions when editing is denied', () => {
    render(<FooterHarness disabled />);

    expect(screen.getByRole('button', { name: 'channel.removeChannel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.testConnection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.discard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.save' })).toBeDisabled();
  });

  it("speaks as the agent's name, not its role title", async () => {
    render(
      <PlatformDetail agentId="agent-id" currentConfig={currentConfig} platformDef={platformDef} />,
      { wrapper: MemoryRouter },
    );

    // The test window is narrow, so the preview opens from its button.
    fireEvent.click(await screen.findByRole('button', { name: 'channel.quickView.open' }));
    // The quick view's bot speaks under the name.
    await waitFor(() => expect(screen.getAllByText('Shadow Arvin').length).toBeGreaterThan(0));
    expect(screen.queryByText('Simulated teammate')).not.toBeInTheDocument();
  });

  it('discards form edits and restores the persisted configuration', async () => {
    render(
      <PlatformDetail agentId="agent-id" currentConfig={currentConfig} platformDef={platformDef} />,
      { wrapper: MemoryRouter },
    );

    // A saved bot opens on its first settings tab; the app ID lives on "connect".
    fireEvent.click(screen.getByRole('tab', { name: 'channel.tab.connect' }));
    openCredentials();
    const applicationId = screen.getByRole('textbox', { name: /^channel.applicationId/ });
    await waitFor(() => expect(applicationId).toHaveValue('app-id'));
    expect(screen.queryByRole('button', { name: 'channel.discard' })).not.toBeInTheDocument();

    fireEvent.change(applicationId, { target: { value: 'edited-app-id' } });
    expect(applicationId).toHaveValue('edited-app-id');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'channel.discard' })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: 'channel.discard' }).click();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^channel.applicationId/ })).toHaveValue('app-id'),
    );
  }, 15_000);

  it('opens the tab named in the URL and writes the picked tab back to it', () => {
    render(
      <MemoryRouter initialEntries={['/agent/agent-id/channel/discord?tab=connect']}>
        <PlatformDetail
          agentId="agent-id"
          currentConfig={currentConfig}
          platformDef={platformDef}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    // A saved bot would open on access; the URL asks for connect.
    expect(screen.getByRole('tab', { name: 'channel.tab.connect' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'channel.tab.access' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=access');
    expect(screen.getByRole('tab', { name: 'channel.tab.access' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('disables the channel enable switch and status refresh when editing is denied', () => {
    render(
      <Header
        disabled
        agentId="agent-id"
        currentConfig={currentConfig}
        platformDef={platformDef}
      />,
    );

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.refreshStatus' })).toBeDisabled();
  });

  it('exposes documentation in the header and keeps other platform actions in overflow', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <Header
        agentId="agent-id"
        platformDef={{
          ...platformDef,
          documentation: {
            portalUrl: 'https://discord.com/developers/applications',
            setupGuideUrl: 'https://lobehub.com/docs/usage/channels/discord',
          },
        }}
      />,
    );

    expect(screen.getByRole('banner')).toHaveTextContent('Discord');
    const documentationButton = screen.getByRole('button', { name: 'channel.documentation' });
    expect(documentationButton).toHaveAttribute('aria-label', 'channel.documentation');
    fireEvent.click(documentationButton);
    expect(open).toHaveBeenCalledWith(
      'https://lobehub.com/docs/usage/channels/discord',
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.getByRole('banner')).toHaveTextContent('channel.openPlatform');
    expect(screen.getByRole('banner')).toHaveTextContent('channel.exportConfig');
    expect(screen.getByRole('banner')).toHaveTextContent('channel.importConfig');

    open.mockRestore();
  });

  it('keeps the enable switch usable to turn off a paid-blocked channel that is still enabled', () => {
    render(
      <Header
        agentId="agent-id"
        currentConfig={currentConfig}
        platformDef={{
          ...platformDef,
          access: {
            allowed: false,
            requiredPlan: 'paid',
            rolloutMode: 'enforce',
          },
          id: 'wechat',
          name: 'WeChat',
        }}
      />,
    );

    expect(screen.getByRole('switch')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'channel.refreshStatus' })).toBeDisabled();
  });

  it('blocks re-enabling a paid-blocked channel once it is disabled', () => {
    render(
      <Header
        agentId="agent-id"
        currentConfig={{ ...currentConfig, enabled: false }}
        platformDef={{
          ...platformDef,
          access: {
            allowed: false,
            requiredPlan: 'paid',
            rolloutMode: 'enforce',
          },
          id: 'wechat',
          name: 'WeChat',
        }}
      />,
    );

    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('renders the paid-feature alert with the platform name and top spacing', () => {
    render(
      <PlatformDetail
        agentId="agent-id"
        platformDef={{
          ...platformDef,
          access: {
            allowed: false,
            requiredPlan: 'paid',
            rolloutMode: 'notice',
          },
          id: 'wechat',
          name: 'WeChat',
        }}
      />,
      { wrapper: MemoryRouter },
    );

    const alert = screen.getByTestId('channel-paid-alert');
    expect(alert).toHaveTextContent('channel.paidFeature.notice.title:WeChat');
    expect(alert).toHaveTextContent('channel.paidFeature.notice.desc.personal:WeChat');
    expect(alert).toHaveStyle({ marginBlockStart: '16px' });
  });

  it('renders personal upgrade guidance and navigates to personal plans', async () => {
    render(
      <PlatformDetail
        agentId="agent-id"
        platformDef={{
          ...platformDef,
          access: {
            allowed: false,
            requiredPlan: 'paid',
            rolloutMode: 'notice',
          },
          id: 'wechat',
          name: 'WeChat',
        }}
      />,
      { wrapper: MemoryRouter },
    );

    const title = screen.getByTestId('channel-paid-alert-title');
    const description = screen.getByTestId('channel-paid-alert-description');
    const cta = within(title).getByRole('button', { name: 'channel.paidFeature.cta.personal' });
    cta.click();

    expect(description).toHaveTextContent('channel.paidFeature.notice.desc.personal:WeChat');
    expect(cta.querySelector('.lucide-external-link')).toBeInTheDocument();
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/plans');
  });

  it('renders workspace upgrade guidance and navigates to workspace plans', async () => {
    mocks.activeWorkspaceId = 'workspace-1';

    render(
      <PlatformDetail
        agentId="agent-id"
        platformDef={{
          ...platformDef,
          access: {
            allowed: false,
            requiredPlan: 'paid',
            rolloutMode: 'notice',
          },
          id: 'wechat',
          name: 'WeChat',
        }}
      />,
      { wrapper: MemoryRouter },
    );

    const title = screen.getByTestId('channel-paid-alert-title');
    const description = screen.getByTestId('channel-paid-alert-description');
    const cta = within(title).getByRole('button', { name: 'channel.paidFeature.cta.workspace' });
    cta.click();

    expect(description).toHaveTextContent('channel.paidFeature.notice.desc.workspace:WeChat');
    expect(cta.querySelector('.lucide-external-link')).toBeInTheDocument();
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/plans');
  });
});

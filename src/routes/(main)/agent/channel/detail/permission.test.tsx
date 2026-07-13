/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Form } from 'antd';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import Header from '../Header';
import Body from './Body';
import Footer from './Footer';
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
        message: {
          error: vi.fn(),
          success: vi.fn(),
          warning: vi.fn(),
        },
      }),
    },
  };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
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

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    disabled,
    onClick,
    title,
  }: {
    disabled?: boolean;
    onClick?: () => void;
    title?: string;
  }) => (
    <button aria-label={title} disabled={disabled} onClick={onClick}>
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
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Form: ({
    children,
    form,
    onValuesChange,
  }: {
    children?: ReactNode;
    form?: ReturnType<typeof Form.useForm>[0];
    onValuesChange?: (changedValues: unknown, values: unknown) => void;
  }) => (
    <Form form={form} onValuesChange={onValuesChange}>
      {children}
    </Form>
  ),
  FormGroup: ({
    active,
    children,
    extra,
    onCollapse,
    title,
  }: {
    active?: boolean;
    children?: ReactNode;
    extra?: ReactNode;
    onCollapse?: (active: boolean) => void;
    title?: ReactNode;
  }) => (
    <section>
      <div
        className="ant-collapse-header"
        data-testid="settings-collapse-header"
        onClick={() => onCollapse?.(!active)}
      >
        <span className="ant-collapse-title">{title}</span>
        <div className="ant-collapse-extra">{extra}</div>
      </div>
      {active && children}
    </section>
  ),
  FormItem: ({
    children,
    label,
    name,
    rules,
    valuePropName,
  }: {
    children?: ReactNode;
    label?: ReactNode;
    name?: string | string[];
    rules?: unknown[];
    valuePropName?: string;
  }) => (
    <Form.Item label={label} name={name} rules={rules as never} valuePropName={valuePropName}>
      {children}
    </Form.Item>
  ),
  Icon: () => null,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    icon,
    loading,
    onClick,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; loading?: boolean }) => (
    <button disabled={disabled || loading} onClick={onClick} {...rest}>
      {icon}
      {children}
    </button>
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
  Switch: ({
    checked,
    disabled,
    onChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onChange?: (next: boolean) => void;
  }) => (
    <button
      aria-checked={checked}
      disabled={disabled}
      role="switch"
      onClick={() => onChange?.(!checked)}
    />
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

const BodyHarness = ({ disabled }: { disabled?: boolean }) => {
  const [form] = Form.useForm();

  return (
    <Body
      hasConfig
      currentConfig={currentConfig}
      disabled={disabled}
      form={form}
      platformDef={platformDef}
    />
  );
};

const FooterHarness = ({ disabled }: { disabled?: boolean }) => {
  const [form] = Form.useForm();

  return (
    <Footer
      hasConfig
      isDirty
      connecting={false}
      currentConfig={currentConfig}
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

describe('Agent channel permission gates', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = null;
    mocks.navigate.mockClear();
  });

  it('renders channel credentials as read-only when editing is denied', () => {
    render(<BodyHarness disabled />);

    expect(screen.getByRole('textbox', { name: 'channel.applicationId' })).toBeDisabled();
    expect(screen.queryByTestId('info-tooltip')).not.toBeInTheDocument();
    expect(screen.getByLabelText('channel.botToken')).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'channel.charLimit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.settingsResetDefault' })).toBeDisabled();
  });

  it('toggles advanced settings from the full header row', () => {
    render(<BodyHarness />);

    const header = screen.getByTestId('settings-collapse-header');
    expect(screen.getByRole('spinbutton', { name: 'channel.charLimit' })).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByRole('spinbutton', { name: 'channel.charLimit' })).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByRole('spinbutton', { name: 'channel.charLimit' })).toBeInTheDocument();
  });

  it('disables mutating channel actions when editing is denied', () => {
    render(<FooterHarness disabled />);

    expect(screen.getByRole('button', { name: 'channel.removeChannel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.testConnection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.discard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.save' })).toBeDisabled();
  });

  it('discards form edits and restores the persisted configuration', async () => {
    render(
      <PlatformDetail agentId="agent-id" currentConfig={currentConfig} platformDef={platformDef} />,
    );

    const applicationId = screen.getByRole('textbox', { name: 'channel.applicationId' });
    await waitFor(() => expect(applicationId).toHaveValue('app-id'));
    expect(screen.queryByRole('button', { name: 'channel.discard' })).not.toBeInTheDocument();

    fireEvent.change(applicationId, { target: { value: 'edited-app-id' } });
    expect(applicationId).toHaveValue('edited-app-id');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'channel.discard' })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: 'channel.discard' }).click();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'channel.applicationId' })).toHaveValue('app-id'),
    );
  });

  it('disables the channel enable switch and status refresh when editing is denied', () => {
    render(
      <Header
        disabled
        agentId="agent-id"
        currentConfig={currentConfig}
        platformDef={platformDef}
        runtimeStatus="connected"
      />,
    );

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.refreshStatus' })).toBeDisabled();
  });

  it('moves the platform links into the trailing overflow menu', () => {
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
    expect(screen.getByRole('banner')).toHaveTextContent('channel.documentation');
    expect(screen.getByRole('banner')).toHaveTextContent('channel.openPlatform');
    expect(screen.getByRole('banner')).toHaveTextContent('channel.exportConfig');
    expect(screen.getByRole('banner')).toHaveTextContent('channel.importConfig');
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

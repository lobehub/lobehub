/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import Body from './Body';
import Footer from './Footer';
import Header from './Header';

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  useTranslation: () => ({
    t: (key: string) => key,
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
  Alert: ({ message, title }: { message?: ReactNode; title?: ReactNode }) => (
    <div>{title || message}</div>
  ),
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Form: ({
    children,
    form,
  }: {
    children?: ReactNode;
    form?: ReturnType<typeof Form.useForm>[0];
  }) => <Form form={form}>{children}</Form>,
  FormGroup: ({
    children,
    extra,
    title,
  }: {
    children?: ReactNode;
    extra?: ReactNode;
    title?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {extra}
      {children}
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
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/FormInput', () => ({
  FormInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  FormPassword: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/InfoTooltip', () => ({
  default: ({ title }: { title?: string }) => <span>{title}</span>,
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
      connecting={false}
      currentConfig={currentConfig}
      disabled={disabled}
      form={form}
      platformDef={platformDef}
      saving={false}
      testing={false}
      onCopied={vi.fn()}
      onDelete={vi.fn()}
      onSave={vi.fn()}
      onTestConnection={vi.fn()}
    />
  );
};

describe('Agent channel permission gates', () => {
  it('renders channel credentials as read-only when editing is denied', () => {
    render(<BodyHarness disabled />);

    expect(screen.getByRole('textbox', { name: 'channel.applicationId' })).toBeDisabled();
    expect(screen.getByLabelText('channel.botToken')).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'channel.charLimit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.settingsResetDefault' })).toBeDisabled();
  });

  it('disables mutating channel actions when editing is denied', () => {
    render(<FooterHarness disabled />);

    expect(screen.getByRole('button', { name: 'channel.removeChannel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.testConnection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.save' })).toBeDisabled();
  });

  it('disables the channel enable switch and status refresh when editing is denied', () => {
    render(
      <Header
        disabled
        currentConfig={currentConfig}
        platformDef={platformDef}
        runtimeStatus="connected"
        onRefreshStatus={vi.fn()}
        onToggleEnable={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'channel.refreshStatus' })).toBeDisabled();
  });
});

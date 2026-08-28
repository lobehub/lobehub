import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerPushSection } from './MessengerPush';
import { WechatQrSetup } from './Wechat';

const messengerServiceMocks = vi.hoisted(() => ({
  createWechatQrSession: vi.fn(),
  getMessengerPushWindow: vi.fn(),
  pollWechatQrSession: vi.fn(),
  sendMessengerPush: vi.fn(),
}));
const useSWRMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Select: ({
    onChange,
    options,
    value,
  }: {
    onChange?: (value: string) => void;
    options?: { label: string; value: string }[];
    value?: string;
  }) => (
    <select value={value} onChange={(event) => onChange?.(event.target.value)}>
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  QRCode: ({
    'aria-label': ariaLabel,
    bgColor,
    color,
    value,
  }: {
    'aria-label'?: string;
    'bgColor'?: string;
    'color'?: string;
    'value': string;
  }) => (
    <span
      aria-label={ariaLabel}
      data-bg-color={bgColor}
      data-color={color}
      data-value={value}
      role="img"
    />
  ),
}));

vi.mock('antd-style', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createStaticStyles: () => ({ error: 'error', qrSlot: 'qrSlot', setup: 'setup' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number | string>) => {
      if (key === 'messenger.push.expiresIn') return `expires in ${params?.value}`;
      if (key === 'messenger.push.alwaysDescription') {
        return `${params?.platform} always available description`;
      }
      if (key === 'messenger.push.windowedDescription') {
        return `${params?.platform} send window description`;
      }
      if (key === 'messenger.push.placeholder') return `Message ${params?.platform}`;
      if (key === 'messenger.push.send') return `Send to ${params?.platform}`;

      return (
        {
          'messenger.push.alwaysAvailable': 'Ready to send',
          'messenger.push.alwaysAvailableHint': 'Direct message available',
          'messenger.push.sectionTitle': 'Message Push',
          'messenger.push.target': 'Destination workspace',
          'messenger.push.title': 'Proactive messages',
          'messenger.push.windowClosed': 'Closed',
          'messenger.push.windowClosedHint': 'Reply in WeChat',
          'messenger.push.windowOpen': 'Open',
          'messenger.wechat.connectCta': 'Connect WeChat',
          'messenger.wechat.qr.tip': 'Scan with WeChat',
          'messenger.wechat.qr.waiting': 'Waiting',
          'messenger.wechat.setupTitle': 'Set up WeChat',
        }[key] ?? key
      );
    },
  }),
}));

vi.mock('swr', () => ({ default: useSWRMock }));

vi.mock('@/components/AsyncError', () => ({ default: () => null }));
vi.mock('@/components/NeuralNetworkLoading', () => ({ default: () => <span>Loading</span> }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/services/messenger', () => ({ messengerService: messengerServiceMocks }));
vi.mock('../i18n', () => ({ getMessengerErrorMessage: () => 'error' }));
vi.mock('./shared', () => ({
  DetailLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  IntegrationDetailSkeleton: () => null,
  UserAgentConnection: () => null,
  styles: { card: 'card', rowIcon: 'rowIcon', rowIdentity: 'rowIdentity' },
  useLinkActions: () => ({ handleSetActive: vi.fn(), handleUnlink: vi.fn() }),
  useMessengerData: () => ({ installations: [], links: [] }),
}));

describe('WechatQrSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messengerServiceMocks.createWechatQrSession.mockResolvedValue({
      qrCodePayload: 'https://liteapp.weixin.qq.com/q/qr-payload',
      sessionId: 'session-1',
      status: 'wait',
    });
  });

  it('encodes the WeChat URL as the QR payload during rescan', async () => {
    render(<WechatQrSetup autoStart onConfirmed={vi.fn()} />);

    const qrCode = await screen.findByRole('img', { name: 'Set up WeChat' });
    expect(qrCode).toHaveAttribute('data-bg-color', '#fff');
    expect(qrCode).toHaveAttribute('data-color', '#000');
    expect(qrCode).toHaveAttribute('data-value', 'https://liteapp.weixin.qq.com/q/qr-payload');
  });

  it('encodes the WeChat URL as the QR payload after the initial connect action', async () => {
    render(<WechatQrSetup onConfirmed={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect WeChat' }));

    expect(await screen.findByRole('img', { name: 'Set up WeChat' })).toHaveAttribute(
      'data-value',
      'https://liteapp.weixin.qq.com/q/qr-payload',
    );
  });
});

describe('MessengerPushSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messengerServiceMocks.sendMessengerPush.mockResolvedValue({ status: 'sent' });
    useSWRMock.mockReturnValue({
      data: {
        deliverability: 'windowed',
        expiresInSeconds: 3600,
        linked: true,
        maxSends: 10,
        queued: 0,
        remaining: 9,
        windowOpen: true,
      },
      mutate: vi.fn(),
    });
  });

  it('renders the section header with the send-window description while the window is open', () => {
    const { container } = render(<MessengerPushSection name="WeChat" platform="wechat" />);

    expect(screen.getByText('Message Push')).toBeInTheDocument();
    expect(screen.getByText('WeChat send window description')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('expires in ~1h')).toBeInTheDocument();
    expect(container).toHaveTextContent('9 / 10');
  });

  it('renders the send-window description while the window is closed', () => {
    useSWRMock.mockReturnValue({
      data: {
        deliverability: 'windowed',
        expiresInSeconds: null,
        linked: true,
        maxSends: 10,
        queued: 0,
        remaining: 0,
        windowOpen: false,
      },
      mutate: vi.fn(),
    });

    render(<MessengerPushSection name="WeChat" platform="wechat" />);

    expect(screen.getByText('WeChat send window description')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('renders an always-available state for non-windowed platforms', () => {
    useSWRMock.mockReturnValue({
      data: {
        deliverability: 'always',
        expiresInSeconds: null,
        linked: true,
        maxSends: 0,
        queued: 0,
        remaining: 0,
        windowOpen: true,
      },
      mutate: vi.fn(),
    });

    render(<MessengerPushSection name="Telegram" platform="telegram" />);

    expect(screen.getByText('Telegram always available description')).toBeInTheDocument();
    expect(screen.getByText('Ready to send')).toBeInTheDocument();
  });

  it('sends to the selected Slack workspace tenant', async () => {
    useSWRMock.mockReturnValue({
      data: {
        deliverability: 'always',
        expiresInSeconds: null,
        linked: true,
        maxSends: 0,
        queued: 0,
        remaining: 0,
        windowOpen: true,
      },
      mutate: vi.fn(),
    });

    render(
      <MessengerPushSection
        name="Slack"
        platform="slack"
        targets={[
          { label: 'Acme', tenantId: 'T_ACME' },
          { label: 'Beta', tenantId: 'T_BETA' },
        ]}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'T_BETA' } });
    fireEvent.change(screen.getByPlaceholderText('Message Slack'), {
      target: { value: 'hello beta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Slack' }));

    await waitFor(() =>
      expect(messengerServiceMocks.sendMessengerPush).toHaveBeenCalledWith({
        content: 'hello beta',
        platform: 'slack',
        tenantId: 'T_BETA',
      }),
    );
  });
});

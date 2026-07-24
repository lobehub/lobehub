import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WechatQrSetup } from './Wechat';
import WechatPushSection from './WechatPush';

const messengerServiceMocks = vi.hoisted(() => ({
  createWechatQrSession: vi.fn(),
  pollWechatQrSession: vi.fn(),
}));
const useSWRMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  Alert: ({ message }: { message?: ReactNode }) => <div>{message}</div>,
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Input: () => <input />,
  Skeleton: { Button: () => <span>Loading</span> },
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { success: vi.fn() } }) },
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

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ error: 'error', qrSlot: 'qrSlot', setup: 'setup' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number | string>) => {
      if (key === 'messenger.wechat.push.expiresIn') return `expires in ${params?.value}`;

      return (
        {
          'messenger.wechat.connectCta': 'Connect WeChat',
          'messenger.wechat.qr.tip': 'Scan with WeChat',
          'messenger.wechat.qr.waiting': 'Waiting',
          'messenger.wechat.setupTitle': 'Set up WeChat',
          'messenger.wechat.push.description': 'WeChat send window description',
          'messenger.wechat.push.sectionTitle': 'Message Push',
          'messenger.wechat.push.title': 'Proactive messages',
          'messenger.wechat.push.windowClosed': 'Closed',
          'messenger.wechat.push.windowClosedHint': 'Reply in WeChat',
          'messenger.wechat.push.windowOpen': 'Open',
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
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
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

describe('WechatPushSection', () => {
  beforeEach(() => {
    useSWRMock.mockReturnValue({
      data: {
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
    const { container } = render(<WechatPushSection />);

    expect(screen.getByText('Message Push')).toBeInTheDocument();
    expect(screen.getByText('WeChat send window description')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('expires in ~1h')).toBeInTheDocument();
    expect(container).toHaveTextContent('9 / 10');
  });

  it('renders the send-window description while the window is closed', () => {
    useSWRMock.mockReturnValue({
      data: {
        expiresInSeconds: null,
        linked: true,
        maxSends: 10,
        queued: 0,
        remaining: 0,
        windowOpen: false,
      },
      mutate: vi.fn(),
    });

    render(<WechatPushSection />);

    expect(screen.getByText('WeChat send window description')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });
});

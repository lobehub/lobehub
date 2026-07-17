import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWechatQrContent, WechatQrSetup } from './Wechat';

const messengerServiceMocks = vi.hoisted(() => ({
  createWechatQrSession: vi.fn(),
  pollWechatQrSession: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Alert: ({ message }: { message?: ReactNode }) => <div>{message}</div>,
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Image: ({ alt, src }: { alt?: string; src?: string }) => (
    <span aria-label={alt} data-src={src} role="img" />
  ),
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
  QRCode: ({ value }: { value: string }) => (
    <span aria-label="Generated QR code" data-value={value} role="img" />
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ error: 'error', qrSlot: 'qrSlot', setup: 'setup' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'messenger.wechat.qr.tip': 'Scan with WeChat',
        'messenger.wechat.qr.waiting': 'Waiting',
        'messenger.wechat.setupTitle': 'Set up WeChat',
      })[key] ?? key,
  }),
}));

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
  useLinkActions: () => ({ handleSetActive: vi.fn(), handleUnlink: vi.fn() }),
  useMessengerData: () => ({ installations: [], links: [] }),
}));

describe('WechatQrSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messengerServiceMocks.createWechatQrSession.mockResolvedValue({
      imageContent: 'iVBORw0KGgoAAAANSUhEUg',
      sessionId: 'session-1',
      status: 'wait',
    });
  });

  it('renders raw QR image content as a PNG data URL instead of encoding it again', async () => {
    render(<WechatQrSetup autoStart onConfirmed={vi.fn()} />);

    expect(await screen.findByRole('img', { name: 'Set up WeChat' })).toHaveAttribute(
      'data-src',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
    );
  });

  it('generates a QR code when WeChat returns a landing-page URL', async () => {
    const qrUrl = 'https://liteapp.weixin.qq.com/q/example?qrcode=token&bot_type=3';
    messengerServiceMocks.createWechatQrSession.mockResolvedValueOnce({
      imageContent: qrUrl,
      sessionId: 'session-1',
      status: 'wait',
    });

    render(<WechatQrSetup autoStart onConfirmed={vi.fn()} />);

    expect(await screen.findByRole('img', { name: 'Generated QR code' })).toHaveAttribute(
      'data-value',
      qrUrl,
    );
  });
});

describe('resolveWechatQrContent', () => {
  it.each([
    ['data:image/png;base64,abc', { type: 'image', value: 'data:image/png;base64,abc' }],
    [
      'https://liteapp.weixin.qq.com/q/qr-code',
      { type: 'value', value: 'https://liteapp.weixin.qq.com/q/qr-code' },
    ],
    ['  raw-base64  ', { type: 'image', value: 'data:image/png;base64,raw-base64' }],
  ])('normalizes %s', (input, expected) => {
    expect(resolveWechatQrContent(input)).toEqual(expected);
  });
});

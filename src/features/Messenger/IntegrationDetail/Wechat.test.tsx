import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWechatQrImageSrc, WechatQrSetup } from './Wechat';

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

  it('renders a QR image URL directly instead of re-encoding it as a QR payload', async () => {
    const qrImageUrl = 'https://weixin.qq.com/x/cAbCdEfGhIj';
    messengerServiceMocks.createWechatQrSession.mockResolvedValueOnce({
      imageContent: qrImageUrl,
      sessionId: 'session-1',
      status: 'wait',
    });

    render(<WechatQrSetup autoStart onConfirmed={vi.fn()} />);

    expect(await screen.findByRole('img', { name: 'Set up WeChat' })).toHaveAttribute(
      'data-src',
      qrImageUrl,
    );
  });
});

describe('resolveWechatQrImageSrc', () => {
  it.each([
    ['data:image/png;base64,abc', 'data:image/png;base64,abc'],
    ['https://weixin.qq.com/x/cAbCdEfGhIj', 'https://weixin.qq.com/x/cAbCdEfGhIj'],
    ['  raw-base64  ', 'data:image/png;base64,raw-base64'],
  ])('normalizes %s', (input, expected) => {
    expect(resolveWechatQrImageSrc(input)).toBe(expected);
  });
});

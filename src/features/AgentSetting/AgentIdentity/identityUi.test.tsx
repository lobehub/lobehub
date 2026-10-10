import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  getInboxMessage: vi.fn(),
  getInboxUnreadCount: vi.fn(),
  list: vi.fn(),
  listInbox: vi.fn(),
  markAllInboxRead: vi.fn(),
  markInboxRead: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: service }));

// No provider configured: only already-owned addresses render.
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: unknown) => unknown) =>
    selector({ serverConfig: { agentIdentityProviders: [] } }),
}));

const ui = vi.hoisted(() => ({ confirmModal: vi.fn(), createModal: vi.fn() }));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: ui.confirmModal,
  createModal: ui.createModal,
}));

const { IDENTITY_CHANNELS } = await import('./const');
const { default: AccountCard } = await import('./AccountCard');
const { default: InboxMessageModal } = await import('./InboxMessageModal');
const { default: InboxSection } = await import('./InboxSection');
const { default: IdentityAccounts } = await import('./IdentityAccounts');

const fresh = (node: React.ReactNode) =>
  render(<SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{node}</SWRConfig>);

const mailChannel = IDENTITY_CHANNELS.find((channel) => channel.kind === 'mail')!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InboxMessageModal', () => {
  it('shows a retryable error instead of a skeleton that never resolves', async () => {
    service.getInboxMessage.mockRejectedValueOnce(new Error('network down'));

    fresh(<InboxMessageModal id={'msg_1'} />);

    expect(await screen.findByText('identity.inbox.detail.loadFailed')).toBeInTheDocument();
  });
});

describe('IdentityAccounts', () => {
  it('shows a mounted address that no built-in channel claims, so it can be released', async () => {
    service.list.mockResolvedValue([
      {
        agentId: 'agt_1',
        capabilities: { receive: true, send: true },
        displayName: null,
        id: 'acc_user',
        identifier: 'me@example.com',
        kind: 'mail',
        provider: 'user',
        status: 'active',
      },
    ]);

    fresh(<IdentityAccounts agentId={'agt_1'} />);

    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    // Its provider stands in for the channel title, and it is releasable.
    expect(screen.getByText('user')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button').at(-1)!);
    expect(ui.confirmModal).toHaveBeenCalledTimes(1);
  });
});

describe('InboxMessageModal attachments', () => {
  it('lists what an attachment-only message carried instead of a blank body', async () => {
    service.getInboxMessage.mockResolvedValue({
      attachments: [{ mimeType: 'image/jpeg', url: 'https://cdn.example.test/photo.jpg' }],
      from: '+15550001111',
      id: 'msg_photo',
      receivedAt: new Date('2026-10-02T00:00:00Z'),
      subject: null,
      text: '',
      to: 'toby@lobe.id',
    });

    fresh(<InboxMessageModal id={'msg_photo'} />);

    const link = await screen.findByRole('link', { name: 'image/jpeg' });
    expect(link).toHaveAttribute('href', 'https://cdn.example.test/photo.jpg');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('AccountCard', () => {
  it('cannot release an address from a read-only view', () => {
    fresh(
      <AccountCard
        disabled
        account={{ id: 'acc_1', identifier: 'toby@lobe.id', status: 'active' } as any}
        agentId={'agt_1'}
        channel={mailChannel}
        onChanged={vi.fn()}
      />,
    );

    // Copy comes first; the release action is the card's last control.
    const release = screen.getAllByRole('button').at(-1)!;
    fireEvent.click(release);

    expect(ui.confirmModal).not.toHaveBeenCalled();
    expect(service.revoke).not.toHaveBeenCalled();
  });
});

describe('InboxSection', () => {
  const rows = [
    {
      from: 'friend@example.com',
      id: 'msg_1',
      readAt: null,
      receivedAt: new Date('2026-10-02T00:00:00Z'),
      subject: 'Lunch?',
    },
  ];

  it('reports the server unread count, not the dots on the loaded page', async () => {
    service.listInbox.mockResolvedValue(rows);
    service.getInboxUnreadCount.mockResolvedValue(73);

    fresh(<InboxSection agentId={'agt_1'} />);

    await waitFor(() =>
      expect(service.getInboxUnreadCount).toHaveBeenCalledWith('agt_1'),
    );
    expect(await screen.findByText('identity.inbox.unread')).toBeInTheDocument();
  });

  it('opens a message from the keyboard', async () => {
    service.listInbox.mockResolvedValue(rows);
    service.getInboxUnreadCount.mockResolvedValue(1);
    service.markInboxRead.mockResolvedValue({ count: 1 });

    fresh(<InboxSection agentId={'agt_1'} />);

    const row = await screen.findByRole('button', { name: /friend@example.com/ });
    expect(row).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });

    await waitFor(() => expect(ui.createModal).toHaveBeenCalledTimes(1));
    expect(service.markInboxRead).toHaveBeenCalledWith(['msg_1']);
  });

  it('pages older mail with a cursor instead of an ever-growing limit', async () => {
    const page = (offset: number, size: number) =>
      Array.from({ length: size }, (_, i) => ({
        from: `sender${offset + i}@example.com`,
        id: `msg_${offset + i}`,
        readAt: new Date('2026-10-02T00:00:00Z'),
        receivedAt: new Date(Date.UTC(2026, 9, 2, 0, 0, 0) - (offset + i) * 1000),
        subject: `Mail ${offset + i}`,
      }));
    const first = page(0, 50);
    const second = page(50, 50);
    service.listInbox.mockImplementation(async ({ before }: { before?: unknown }) =>
      before ? (before as any).id === 'msg_49' ? second : page(100, 3) : first,
    );
    service.getInboxUnreadCount.mockResolvedValue(0);

    fresh(<InboxSection agentId={'agt_1'} />);

    // Two clicks: beyond the server's 100-row cap if the window just grew.
    fireEvent.click(await screen.findByRole('button', { name: 'identity.inbox.loadMore' }));
    await screen.findByRole('button', { name: /sender99@example.com/ });
    fireEvent.click(screen.getByRole('button', { name: 'identity.inbox.loadMore' }));
    await screen.findByRole('button', { name: /sender102@example.com/ });

    const limits = service.listInbox.mock.calls.map(([params]) => params.limit);
    expect(Math.max(...limits)).toBe(50);
    expect(service.listInbox).toHaveBeenCalledWith(
      expect.objectContaining({ before: { id: 'msg_49', receivedAt: first[49].receivedAt } }),
    );
    // The short third page ends the list.
    expect(screen.queryByRole('button', { name: 'identity.inbox.loadMore' })).toBeNull();
  });
});

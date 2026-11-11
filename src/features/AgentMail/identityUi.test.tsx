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
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: ui.confirmModal,
  createModal: ui.createModal,
}));

const { IDENTITY_CHANNELS } = await import('./const');
const { default: InboxMessageDetail } = await import('./InboxMessageDetail');
const { default: InboxSection } = await import('./InboxSection');
const { INBOX_REFRESH_INTERVAL_MS, useAgentAccounts } = await import('./useAgentIdentity');

const fresh = (node: React.ReactNode) =>
  render(<SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{node}</SWRConfig>);

const mailChannel = IDENTITY_CHANNELS.find((channel) => channel.kind === 'mail')!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InboxMessageDetail', () => {
  it('shows a retryable error instead of a skeleton that never resolves', async () => {
    service.getInboxMessage.mockRejectedValueOnce(new Error('network down'));

    fresh(<InboxMessageDetail id={'msg_1'} />);

    expect(await screen.findByText('identity.inbox.detail.loadFailed')).toBeInTheDocument();
  });
});

describe('InboxMessageDetail attachments', () => {
  it('lists what an attachment-only message carried instead of a blank body', async () => {
    service.getInboxMessage.mockResolvedValue({
      attachments: [
        { contentType: 'image/jpeg', filename: 'photo.jpg', index: 0, size: 2_516_582 },
        { contentType: 'application/pdf', index: 1 },
      ],
      from: '+15550001111',
      id: 'msg_photo',
      receivedAt: new Date('2026-10-02T00:00:00Z'),
      subject: null,
      text: '',
      to: 'toby@lobe.id',
    });

    fresh(<InboxMessageDetail id={'msg_photo'} />);

    // Named by file (or type) and size; nothing is fetched from the provider,
    // so the list neither links nor previews what an outside sender sent.
    expect(await screen.findByText('photo.jpg · 2.4 MB')).toBeInTheDocument();
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
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

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);

    await waitFor(() =>
      expect(service.getInboxUnreadCount).toHaveBeenCalledWith('agt_1', undefined),
    );
    expect(await screen.findByText('identity.inbox.unread')).toBeInTheDocument();
  });

  it('opens a message from the keyboard', async () => {
    service.listInbox.mockResolvedValue(rows);
    service.getInboxUnreadCount.mockResolvedValue(1);
    service.markInboxRead.mockResolvedValue({ count: 1 });

    const onOpen = vi.fn();
    fresh(<InboxSection agentId={'agt_1'} onOpen={onOpen} />);

    const row = await screen.findByRole('button', { name: /friend@example.com/ });
    expect(row).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });

    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
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
      before ? ((before as any).id === 'msg_49' ? second : page(100, 3)) : first,
    );
    service.getInboxUnreadCount.mockResolvedValue(0);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);

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

  it('keeps the loaded messages when an older page fails, with a retry below them', async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({
      from: `sender${i}@example.com`,
      id: `msg_${i}`,
      readAt: new Date('2026-10-02T00:00:00Z'),
      receivedAt: new Date(Date.UTC(2026, 9, 2) - i * 1000),
      subject: `Mail ${i}`,
    }));
    service.listInbox.mockImplementation(async ({ before }: { before?: unknown }) => {
      if (before) throw new Error('older page failed');
      return first;
    });
    service.getInboxUnreadCount.mockResolvedValue(0);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'identity.inbox.loadMore' }));

    expect(await screen.findByText('identity.inbox.loadFailed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sender0@example.com/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sender49@example.com/ })).toBeInTheDocument();
  });

  it('reports a failed refresh when the cached inbox is empty', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    service.listInbox.mockResolvedValueOnce([]).mockRejectedValue(new Error('inbox unavailable'));
    service.getInboxUnreadCount.mockResolvedValue(0);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);
    await screen.findByText('identity.inbox.empty');

    await vi.advanceTimersByTimeAsync(INBOX_REFRESH_INTERVAL_MS + 100);

    // An unreachable inbox must not read as an empty one.
    expect(await screen.findByText('identity.inbox.loadFailed')).toBeInTheDocument();
    expect(screen.getByText('identity.inbox.empty')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('picks up a delivery that lands while the tab stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    service.listInbox.mockResolvedValueOnce(rows).mockResolvedValue([
      {
        from: 'otp@service.com',
        id: 'msg_2',
        readAt: null,
        receivedAt: new Date('2026-10-02T00:01:00Z'),
        subject: 'Your code',
      },
      ...rows,
    ]);
    service.getInboxUnreadCount.mockResolvedValue(1);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);
    await screen.findByRole('button', { name: /friend@example.com/ });

    await vi.advanceTimersByTimeAsync(INBOX_REFRESH_INTERVAL_MS + 100);

    expect(await screen.findByRole('button', { name: /otp@service.com/ })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

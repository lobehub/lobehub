import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  getInboxMessage: vi.fn(),
  getInboxUnreadCount: vi.fn(),
  listInbox: vi.fn(),
  markAllInboxRead: vi.fn(),
  markInboxRead: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: service }));

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

describe('AccountCard', () => {
  it('cannot release an address from a read-only view', () => {
    fresh(
      <AccountCard
        disabled
        agentId={'agt_1'}
        channel={mailChannel}
        account={
          {
            capabilities: { receive: true, send: true },
            id: 'acc_1',
            identifier: 'toby@lobe.id',
            status: 'active',
          } as any
        }
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

    await waitFor(() => expect(service.getInboxUnreadCount).toHaveBeenCalledWith('agt_1'));
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
});

import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ getMailConversation: vi.fn() }));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: service }));

const { default: InboxMessageDetail } = await import('./InboxMessageDetail');

const fresh = (node: React.ReactNode) =>
  render(<SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{node}</SWRConfig>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InboxMessageDetail', () => {
  it('shows a retryable error instead of a skeleton that never resolves', async () => {
    service.getMailConversation.mockRejectedValueOnce(new Error('network down'));

    fresh(<InboxMessageDetail id={'msg_1'} />);

    expect(await screen.findByText('identity.inbox.detail.loadFailed')).toBeInTheDocument();
  });
});

describe('InboxMessageDetail attachments', () => {
  it('lists what an attachment-only message carried instead of a blank body', async () => {
    service.getMailConversation.mockResolvedValue([
      {
        attachments: [
          { contentType: 'image/jpeg', filename: 'photo.jpg', index: 0, size: 2_516_582 },
          { contentType: 'application/pdf', index: 1 },
        ],
        deliveredAt: new Date('2026-10-02T00:00:00Z'),
        fromAddress: 'friend@example.com',
        id: 'msg_photo',
        isUnread: false,
        subject: null,
        text: '',
        to: [{ address: 'toby@lobe.id' }],
      },
    ]);

    fresh(<InboxMessageDetail id={'msg_photo'} />);

    // Named by file (or type) and size; nothing is fetched from the provider,
    // so the list neither links nor previews what an outside sender sent.
    expect(await screen.findByText('photo.jpg · 2.4 MB')).toBeInTheDocument();
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('InboxMessageDetail for mail that left', () => {
  it('says the mail is gone instead of loading forever', async () => {
    service.getMailConversation.mockResolvedValue([]);

    fresh(<InboxMessageDetail id={'msg_gone'} />);

    expect(await screen.findByText('identity.inbox.detail.gone')).toBeInTheDocument();
  });
});

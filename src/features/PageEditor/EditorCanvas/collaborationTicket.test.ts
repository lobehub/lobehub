import { describe, expect, it, vi } from 'vitest';

import {
  getPageCollaborationBrowserTicketRefreshDelay,
  issuePageCollaborationBrowserTicket,
  shouldRetainPageCollaborationBrowserTicket,
} from './collaborationTicket';

const { issueBrowserTicket } = vi.hoisted(() => ({ issueBrowserTicket: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    documentCollaboration: {
      issueBrowserTicket: { mutate: issueBrowserTicket },
    },
  },
}));

describe('issuePageCollaborationBrowserTicket', () => {
  it('requests only the document id and normalizes a reusable ticket response', async () => {
    issueBrowserTicket.mockResolvedValue({
      clientKind: 'browser',
      documentId: 'document-1',
      expiresAt: '2099-08-29T00:10:00.000Z',
      roomId: 'document-1',
      ticket: 'browser-ticket',
    });

    const result = await issuePageCollaborationBrowserTicket('document-1');

    expect(issueBrowserTicket).toHaveBeenCalledWith({ documentId: 'document-1' });
    expect(result).toEqual({
      clientKind: 'browser',
      documentId: 'document-1',
      expiresAt: '2099-08-29T00:10:00.000Z',
      roomId: 'document-1',
      ticket: 'browser-ticket',
    });
  });

  it('rejects a ticket for another room or an invalid expiry', async () => {
    issueBrowserTicket.mockResolvedValueOnce({
      clientKind: 'browser',
      documentId: 'other-document',
      expiresAt: '2099-08-29T00:10:00.000Z',
      roomId: 'other-document',
      ticket: 'browser-ticket',
    });
    await expect(issuePageCollaborationBrowserTicket('document-1')).rejects.toThrow(
      'Invalid browser collaboration ticket response',
    );

    issueBrowserTicket.mockResolvedValueOnce({
      documentId: 'document-1',
      expiresAt: 'not-a-date',
      roomId: 'document-1',
      ticket: 'browser-ticket',
    });
    await expect(issuePageCollaborationBrowserTicket('document-1')).rejects.toThrow(
      'Invalid browser collaboration ticket response',
    );
  });

  it('refreshes a ten-minute ticket once near expiry instead of rebuilding every minute', () => {
    vi.useFakeTimers();
    const now = Date.parse('2099-08-29T00:00:00.000Z');
    try {
      expect(getPageCollaborationBrowserTicketRefreshDelay('2099-08-29T00:10:00.000Z', now)).toBe(
        9.5 * 60 * 1000,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an unexpired ticket when a refresh API call fails, and clears it after expiry', () => {
    const ticket = {
      clientKind: 'browser' as const,
      documentId: 'document-1',
      expiresAt: '2099-08-29T00:10:00.000Z',
      roomId: 'document-1',
      ticket: 'browser-ticket',
    };
    expect(
      shouldRetainPageCollaborationBrowserTicket(ticket, Date.parse('2099-08-29T00:09:00.000Z')),
    ).toBe(true);
    expect(
      shouldRetainPageCollaborationBrowserTicket(ticket, Date.parse('2099-08-29T00:10:00.000Z')),
    ).toBe(false);
  });
});

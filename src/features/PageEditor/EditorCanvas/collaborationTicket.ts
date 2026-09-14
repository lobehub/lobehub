import { lambdaClient } from '@/libs/trpc/client';

export interface PageCollaborationBrowserTicket {
  clientKind: 'browser';
  documentId: string;
  expiresAt: string;
  roomId: string;
  ticket: string;
}

export const PAGE_COLLABORATION_BROWSER_TICKET_MIN_REFRESH_DELAY_MS = 5_000;
export const PAGE_COLLABORATION_BROWSER_TICKET_REFRESH_MARGIN_MS = 30_000;

/** Refresh once shortly before expiry, rather than periodically rebuilding a provider. */
export const getPageCollaborationBrowserTicketRefreshDelay = (
  expiresAt: string,
  now = Date.now(),
): number =>
  Math.max(
    PAGE_COLLABORATION_BROWSER_TICKET_MIN_REFRESH_DELAY_MS,
    Date.parse(expiresAt) - now - PAGE_COLLABORATION_BROWSER_TICKET_REFRESH_MARGIN_MS,
  );

export const shouldRetainPageCollaborationBrowserTicket = (
  ticket: PageCollaborationBrowserTicket | null,
  now = Date.now(),
): ticket is PageCollaborationBrowserTicket => {
  if (!ticket) return false;
  const expiry = Date.parse(ticket.expiresAt);
  return Number.isFinite(expiry) && expiry > now;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Request the reusable browser room capability. The response intentionally
 * contains no rewrite request/worker fields; browser reconnects reuse or
 * refresh this independent ticket until its short expiry.
 */
export const issuePageCollaborationBrowserTicket = async (
  documentId: string,
): Promise<PageCollaborationBrowserTicket> => {
  const response = await lambdaClient.documentCollaboration.issueBrowserTicket.mutate({
    documentId,
  });
  if (
    !isRecord(response) ||
    response.clientKind !== 'browser' ||
    typeof response.documentId !== 'string' ||
    typeof response.expiresAt !== 'string' ||
    typeof response.roomId !== 'string' ||
    typeof response.ticket !== 'string' ||
    response.documentId !== documentId ||
    response.roomId !== documentId ||
    response.ticket.length === 0
  ) {
    throw new Error('Invalid browser collaboration ticket response');
  }
  const expiry = Date.parse(response.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new Error('Browser collaboration ticket is already expired');
  }

  return {
    clientKind: 'browser',
    documentId: response.documentId,
    expiresAt: new Date(expiry).toISOString(),
    roomId: response.roomId,
    ticket: response.ticket,
  };
};

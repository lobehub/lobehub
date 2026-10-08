import { useState } from 'react';
import useSWR from 'swr';

import { agentAccountService } from '@/services/agentAccount';

const accountsKey = (agentId: string): [string, string] | null =>
  agentId ? ['agent-accounts', agentId] : null;

/** How much of the inbox one read asks for; `loadMore` grows it from here. */
export const INBOX_PAGE_SIZE = 50;

const inboxKey = (agentId: string, limit: number): [string, number, string] | null =>
  agentId ? ['agent-inbox', limit, agentId] : null;

/** The addresses this agent owns. */
export const useAgentAccounts = (agentId: string) =>
  useSWR(accountsKey(agentId), ([, id]) => agentAccountService.list({ agentId: id }));

/**
 * What has arrived at those addresses, newest first.
 *
 * The read is newest-first and takes no cursor, so older mail is reached by
 * widening the window rather than by paging backwards — a fixed page made
 * everything past the 50th message permanently unreachable. The window only
 * grows, so rows already on screen stay where they are.
 */
export const useAgentInbox = (agentId: string) => {
  const [limit, setLimit] = useState(INBOX_PAGE_SIZE);
  const inbox = useSWR(inboxKey(agentId, limit), ([, size, id]) =>
    agentAccountService.listInbox({ agentId: id, limit: size }),
  );

  return {
    ...inbox,
    /** The window came back full, so the inbox may hold older mail. */
    hasMore: (inbox.data?.length ?? 0) >= limit,
    /** Ask for one more page without disturbing what is already on screen. */
    loadMore: () => setLimit((current) => current + INBOX_PAGE_SIZE),
  };
};

/**
 * The server's unread count. The list above stops at its current window, so
 * counting its unread dots would under-report a busy inbox.
 */
export const useAgentInboxUnreadCount = (agentId: string) =>
  useSWR(agentId ? ['agent-inbox-unread', agentId] : null, ([, id]) =>
    agentAccountService.getInboxUnreadCount(id),
  );

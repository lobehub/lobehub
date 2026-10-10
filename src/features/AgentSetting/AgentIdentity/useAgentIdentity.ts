import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import type { AgentInboxMessage } from '@lobechat/types';
import { agentAccountService } from '@/services/agentAccount';

const accountsKey = (agentId: string): [string, string] | null =>
  agentId ? ['agent-accounts', agentId] : null;

/** One page of the inbox. Stays under the server's per-request cap (100). */
export const INBOX_PAGE_SIZE = 50;

/** The addresses this agent owns. */
export const useAgentAccounts = (agentId: string) =>
  useSWR(accountsKey(agentId), ([, id]) => agentAccountService.list({ agentId: id }));

/**
 * What has arrived at those addresses, newest first.
 *
 * Paged by a keyset cursor (the last row of the previous page), so every
 * request asks for one fixed-size page however far back the user scrolls,
 * and rows already on screen stay where they are.
 */
export const useAgentInbox = (agentId: string) => {
  const inbox = useSWRInfinite(
    (pageIndex, previous: AgentInboxMessage[] | null) => {
      if (!agentId) return null;
      if (pageIndex === 0) return ['agent-inbox', agentId, null] as const;
      const last = previous?.at(-1);
      // The previous page came back short: there is nothing older to ask for.
      if (!last || previous!.length < INBOX_PAGE_SIZE) return null;
      return ['agent-inbox', agentId, { id: last.id, receivedAt: last.receivedAt }] as const;
    },
    ([, id, before]) =>
      agentAccountService.listInbox({
        agentId: id,
        before: before ?? undefined,
        limit: INBOX_PAGE_SIZE,
      }),
  );

  const pages = inbox.data;
  const lastPage = pages?.at(-1);

  return {
    data: pages?.flat(),
    error: inbox.error,
    /** The last page came back full, so the inbox may hold older mail. */
    hasMore: (lastPage?.length ?? 0) >= INBOX_PAGE_SIZE,
    isLoading: inbox.isLoading,
    /** Fetch the next page without disturbing what is already on screen. */
    loadMore: () => void inbox.setSize((size) => size + 1),
    mutate: inbox.mutate,
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

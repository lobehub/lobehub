import useSWR from 'swr';

import { agentAccountService } from '@/services/agentAccount';

const accountsKey = (agentId: string): [string, string] | null =>
  agentId ? ['agent-accounts', agentId] : null;

const inboxKey = (agentId: string): [string, string] | null =>
  agentId ? ['agent-inbox', agentId] : null;

/** The addresses this agent owns. */
export const useAgentAccounts = (agentId: string) =>
  useSWR(accountsKey(agentId), ([, id]) => agentAccountService.list({ agentId: id }));

/** What has arrived at those addresses, newest first. */
export const useAgentInbox = (agentId: string) =>
  useSWR(inboxKey(agentId), ([, id]) => agentAccountService.listInbox({ agentId: id, limit: 50 }));

/**
 * The server's unread count. The list above stops at 50 rows, so counting its
 * unread dots would under-report a busy inbox.
 */
export const useAgentInboxUnreadCount = (agentId: string) =>
  useSWR(agentId ? ['agent-inbox-unread', agentId] : null, ([, id]) =>
    agentAccountService.getInboxUnreadCount(id),
  );

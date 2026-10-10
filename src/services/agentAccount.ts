import type { AgentAccountKind, AgentInboxMessage } from '@lobechat/types';
import type { inferRouterOutputs } from '@trpc/server';

import { lambdaClient } from '@/libs/trpc/client';
import type { LambdaRouter } from '@/server/routers/lambda';

type AgentAccountRouterOutputs = inferRouterOutputs<LambdaRouter>['agentAccount'];
type InboxRow = AgentAccountRouterOutputs['inbox']['list'][number];

/**
 * One identity account as the control plane returns it. Derived from the router
 * rather than restated, so the client can never drift from the contract; the
 * credential is structurally absent, and `hasCredential` is all a read knows.
 */
export type AgentAccountView = AgentAccountRouterOutputs['list'][number];

export interface ListAgentAccountsParams {
  agentId?: string;
  kind?: AgentAccountKind;
  provider?: string;
}

export interface ProvisionAgentAccountParams {
  agentId: string;
  displayName?: string;
  /** Preferred local part for a mail address; the provider may ignore it. */
  prefix?: string;
  provider: string;
}

export interface ListAgentInboxParams {
  accountId?: string;
  agentId: string;
  /** Keyset cursor: the last row of the previous page. */
  before?: { id: string; receivedAt: Date };
  limit?: number;
  unreadOnly?: boolean;
}

/**
 * `codes` and `metadata` are nullable in storage (a column default is not a
 * NOT NULL); the read model declares `codes` as a plain array, so the boundary
 * normalizes instead of leaking `null` into every consumer.
 */
const toInboxMessage = (row: InboxRow): AgentInboxMessage => ({
  accountId: row.accountId,
  agentId: row.agentId,
  codes: row.codes ?? [],
  createdAt: row.createdAt,
  from: row.from,
  id: row.id,
  kind: row.kind,
  readAt: row.readAt,
  receivedAt: row.receivedAt,
  subject: row.subject,
  text: row.text,
  threadKey: row.threadKey,
  to: row.to,
});

/**
 * Client for the agent-account control plane.
 *
 * Everything here maps 1:1 onto `agentAccount` tRPC procedures — no client-side
 * orchestration, no cached identity: the accounts and the inbox both change
 * outside this tab (a webhook delivers, another device releases), so a stale
 * local copy would be a lie rather than a convenience.
 */
class AgentAccountService {
  list = (params?: ListAgentAccountsParams): Promise<AgentAccountView[]> =>
    lambdaClient.agentAccount.list.query(params);

  provision = async (params: ProvisionAgentAccountParams): Promise<AgentAccountView> => {
    const account = await lambdaClient.agentAccount.provision.mutate(params);
    // The router answers either an account or an error; a silent `undefined`
    // would leave the tab showing success for an address it never received.
    if (!account) throw new Error('Provisioning returned no account');

    return account;
  };

  revoke = (id: string, options?: { purgeCredential?: boolean; release?: boolean }) =>
    lambdaClient.agentAccount.revoke.mutate({
      id,
      purgeCredential: options?.purgeCredential,
      release: options?.release,
    });

  // --------------- Inbox ---------------

  listInbox = async (params: ListAgentInboxParams): Promise<AgentInboxMessage[]> => {
    const rows = await lambdaClient.agentAccount.inbox.list.query(params);

    return rows.map(toInboxMessage);
  };

  /** Unread across the whole inbox, not just the page a list happened to load. */
  getInboxUnreadCount = async (agentId: string): Promise<number> =>
    (await lambdaClient.agentAccount.inbox.unreadCount.query({ agentId })).unreadCount;

  getInboxMessage = async (id: string): Promise<AgentInboxMessage> =>
    toInboxMessage(await lambdaClient.agentAccount.inbox.get.query({ id }));

  markInboxRead = (ids: string[]) => lambdaClient.agentAccount.inbox.markRead.mutate({ ids });

  markAllInboxRead = (agentId: string) =>
    lambdaClient.agentAccount.inbox.markAllRead.mutate({ agentId });
}

export const agentAccountService = new AgentAccountService();

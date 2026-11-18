import type { AgentInboxMessageSummary } from '@lobechat/types';
import { useState } from 'react';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';
import useSWRInfinite from 'swr/infinite';

import { agentAccountService } from '@/services/agentAccount';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { IDENTITY_CHANNELS } from './const';

/** The channel to offer; one this deployment cannot fulfil would only fail on click. */
export const useOpenableChannel = () => {
  const providers = useServerConfigStore(serverConfigSelectors.agentIdentityProviders);

  return IDENTITY_CHANNELS.find((channel) => providers.includes(channel.provider));
};

const accountsKey = (agentId: string): [string, string] | null =>
  agentId ? ['agent-accounts', agentId] : null;

/** One page of the inbox. Stays under the server's per-request cap (100). */
export const INBOX_PAGE_SIZE = 50;

/**
 * Deliveries land from outside — a webhook, not this tab — so a person
 * watching for a verification email must see it without refocusing the
 * window. SWR pauses the poll while the tab is hidden.
 */
export const INBOX_REFRESH_INTERVAL_MS = 30_000;

/** The addresses this agent owns. */
export const useAgentAccounts = (agentId: string) =>
  useSWR(accountsKey(agentId), ([, id]) => agentAccountService.list({ agentId: id }));

/** One stored message, read by id rather than taken from a possibly stale list row. */
export const useInboxMessage = (id?: string) =>
  useSWR(id ? ['agent-inbox-message', id] : null, ([, messageId]) =>
    agentAccountService.getInboxMessage(messageId),
  );

/**
 * A message reached through its URL rather than a list row: read it and clear
 * its unread mark before the list and count load, so neither shows it as unread.
 */
const openMessageFromUrl = async (id: string) => {
  const message = await agentAccountService.getInboxMessage(id);
  if (message.readAt) return message;

  try {
    await agentAccountService.markInboxRead([id]);
  } catch (error) {
    // The message still opens; a failed read-mark only affects the dot.
    console.error('[AgentIdentity] mark read failed', error);
  }

  return message;
};

/**
 * The mailbox being read, out of the addresses the agent still holds.
 *
 * Derived rather than stored as a fallback, so releasing the selected address
 * lands on the next one without any bookkeeping. Until the reader picks one, a
 * message opened from its URL decides, so both panes show the same mailbox.
 */
export const useMailbox = (agentId: string, messageId?: string) => {
  const { data, error, isLoading, mutate } = useAgentAccounts(agentId);
  const [selectedId, select] = useState<string>();
  // Immutable: one open is one read, so a focus refetch must not stamp it again.
  const openMessage = useSWRImmutable(
    !selectedId && messageId ? ['agent-inbox-open-message', messageId] : null,
    ([, id]) => openMessageFromUrl(id),
  );
  const accounts = (data ?? []).filter((account) => account.status !== 'revoked');
  const preferredId = selectedId ?? openMessage.data?.accountId;

  return {
    accounts,
    current: accounts.find((account) => account.id === preferredId) ?? accounts[0],
    data: openMessage.isLoading ? undefined : data,
    error,
    isLoading: isLoading || openMessage.isLoading,
    mutate,
    select,
  };
};

export type Mailbox = ReturnType<typeof useMailbox>;

/**
 * What has arrived at one address, newest first (every address when none is given).
 *
 * Paged by a keyset cursor (the last row of the previous page), so every
 * request asks for one fixed-size page however far back the user scrolls,
 * and rows already on screen stay where they are.
 */
export const useAgentInbox = (agentId: string, accountId?: string) => {
  const inbox = useSWRInfinite(
    (pageIndex, previous: AgentInboxMessageSummary[] | null) => {
      if (!agentId) return null;
      if (pageIndex === 0) return ['agent-inbox', agentId, accountId, null] as const;
      const last = previous?.at(-1);
      // The previous page came back short: there is nothing older to ask for.
      if (!last || previous!.length < INBOX_PAGE_SIZE) return null;
      return [
        'agent-inbox',
        agentId,
        accountId,
        { id: last.id, receivedAt: last.receivedAt },
      ] as const;
    },
    ([, id, account, before]) =>
      agentAccountService.listInbox({
        accountId: account,
        agentId: id,
        before: before ?? undefined,
        limit: INBOX_PAGE_SIZE,
      }),
    { refreshInterval: INBOX_REFRESH_INTERVAL_MS },
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
export const useAgentInboxUnreadCount = (agentId: string, accountId?: string) =>
  useSWR(
    agentId ? ['agent-inbox-unread', agentId, accountId] : null,
    ([, id, account]) => agentAccountService.getInboxUnreadCount(id, account),
    { refreshInterval: INBOX_REFRESH_INTERVAL_MS },
  );

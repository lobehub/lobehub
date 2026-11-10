import type { AgentMailFolder } from '@lobechat/types';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { agentAccountService } from '@/services/agentAccount';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { IDENTITY_CHANNELS } from './const';
import { mailConversationKey } from './useMailList';

/** The channel to offer; one this deployment cannot fulfil would only fail on click. */
export const useOpenableChannel = () => {
  const providers = useServerConfigStore(serverConfigSelectors.agentIdentityProviders);

  return IDENTITY_CHANNELS.find((channel) => providers.includes(channel.provider));
};

const accountsKey = (agentId: string): [string, string] | null =>
  agentId ? ['agent-accounts', agentId] : null;

/** The addresses this agent owns. */
export const useAgentAccounts = (agentId: string) =>
  useSWR(accountsKey(agentId), ([, id]) => agentAccountService.list({ agentId: id }));

/**
 * The mailbox being read, out of the addresses the agent still holds.
 *
 * Derived rather than stored as a fallback, so releasing the selected address
 * lands on the next one without any bookkeeping. Until the reader picks one, a
 * message opened from its URL decides, so both panes show the same mailbox.
 */
export const useMailbox = (agentId: string, messageId?: string, folder?: AgentMailFolder) => {
  const { data, error, isLoading, mutate } = useAgentAccounts(agentId);
  const [selectedId, select] = useState<string>();
  const { mutate: mutateCache } = useSWRConfig();
  // A conversation reached through its URL rather than a list row names its
  // own mailbox. Read once, unread state intact, and handed to the reading
  // pane, which opens and marks it exactly as it would from the list; its
  // write shows in the list and the count as soon as they load.
  const openMessage = useSWRImmutable(
    !selectedId && messageId ? ['agent-mail-open-message', messageId, folder] : null,
    async ([, id, view]) => {
      const conversation = await agentAccountService.getMailConversation({ folder: view, id });
      await mutateCache(mailConversationKey(id, view), conversation, { revalidate: false });
      return { accountId: conversation[0]?.accountId };
    },
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

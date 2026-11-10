import type { AgentMailFolder } from '@lobechat/types';
import { useState } from 'react';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';

import { agentAccountService } from '@/services/agentAccount';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { IDENTITY_CHANNELS } from './const';
import { readMailMessage } from './useMailList';

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
 * A message reached through its URL rather than a list row: read it and clear
 * its unread mark before the list and count load, so neither shows it as unread.
 */
const openMessageFromUrl = async (id: string, folder?: AgentMailFolder) => {
  const message = await readMailMessage(id, folder);
  if (!message || message.readAt) return message;

  try {
    await agentAccountService.markMailRead({ ids: [message.id] });
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
export const useMailbox = (agentId: string, messageId?: string, folder?: AgentMailFolder) => {
  const { data, error, isLoading, mutate } = useAgentAccounts(agentId);
  const [selectedId, select] = useState<string>();
  // Immutable: one open is one read, so a focus refetch must not stamp it again.
  const openMessage = useSWRImmutable(
    !selectedId && messageId ? ['agent-mail-open-message', messageId, folder] : null,
    ([, id, view]) => openMessageFromUrl(id, view),
  );
  const accounts = (data ?? []).filter((account) => account.status !== 'revoked');
  const preferredId = selectedId ?? openMessage.data?.accountId ?? undefined;

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

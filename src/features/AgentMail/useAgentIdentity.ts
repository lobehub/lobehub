import type { AgentMailFolder } from '@lobechat/types';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { agentAccountService } from '@/services/agentAccount';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { IDENTITY_CHANNELS } from './const';
import { idsToMarkReadOnOpen } from './conversation';
import { chunk, MAX_IDS_PER_WRITE } from './mailWrites';
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
 * A conversation reached through its URL rather than a list row: clear what
 * opening it shows as unread before the list and count load, so neither shows
 * it as unread. Answers the conversation as it now stands.
 */
const openMessageFromUrl = async (id: string, folder?: AgentMailFolder, readOnly?: boolean) => {
  const conversation = await agentAccountService.getMailConversation({ folder, id });
  // A read-only viewer reads without leaving a trace.
  const unread = new Set(readOnly ? [] : idsToMarkReadOnOpen(conversation));

  try {
    await Promise.all(
      chunk([...unread], MAX_IDS_PER_WRITE).map((ids) => agentAccountService.markMailRead({ ids })),
    );
  } catch (error) {
    // The conversation still opens; a failed read-mark only affects the dot.
    console.error('[AgentIdentity] mark read failed', error);
    return conversation;
  }

  return conversation.map((mail) => (unread.has(mail.id) ? { ...mail, isUnread: false } : mail));
};

/**
 * The mailbox being read, out of the addresses the agent still holds.
 *
 * Derived rather than stored as a fallback, so releasing the selected address
 * lands on the next one without any bookkeeping. Until the reader picks one, a
 * message opened from its URL decides, so both panes show the same mailbox.
 */
export const useMailbox = (
  agentId: string,
  messageId?: string,
  folder?: AgentMailFolder,
  readOnly?: boolean,
) => {
  const { data, error, isLoading, mutate } = useAgentAccounts(agentId);
  const [selectedId, select] = useState<string>();
  // Immutable: one open is one read, so a focus refetch must not stamp it again.
  const { mutate: mutateCache } = useSWRConfig();
  const openMessage = useSWRImmutable(
    !selectedId && messageId ? ['agent-mail-open-message', messageId, folder] : null,
    async ([, id, view]) => {
      const conversation = await openMessageFromUrl(id, view, readOnly);
      // Seeded so the reading pane starts from the read it just made, rather
      // than reading again and marking the same mails a second time.
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

'use client';

import type { AgentInboxMessage } from '@lobechat/types';
import { confirmModal, createModal, toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { agentAccountService, type AgentAccountView } from '@/services/agentAccount';

import type { IdentityChannel } from './const';
import InboxMessageModal from './InboxMessageModal';

/** Open one stored message. Imperative because the trigger is a list row. */
const openMessageModal = (id: string) =>
  createModal({
    content: <InboxMessageModal id={id} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 20 },
      header: { display: 'none' },
    },
    width: 640,
  });

export interface UseAccountActionsParams {
  agentId: string;
  /** Revalidate the addresses after opening or releasing one. */
  onChanged: () => Promise<unknown> | void;
}

/**
 * Opening and releasing an address.
 *
 * Both end the same way — revalidate the list they changed — and both degrade
 * the same way: a provider refusal is surfaced with the provider's own reason,
 * never a generic failure, because "that prefix is taken" and "this deployment
 * has no mailbox service" are different things for the user to act on.
 */
export const useAccountActions = ({ agentId, onChanged }: UseAccountActionsParams) => {
  const { t } = useTranslation('setting');

  const provision = useCallback(
    async (channel: IdentityChannel, prefix: string) => {
      // A provider that cannot honour a prefix must not be sent a meaningless
      // one, so the preference is only forwarded down a prefixable channel.
      const requested = channel.prefixable ? prefix.trim() : '';

      try {
        const account = await agentAccountService.provision({
          agentId,
          prefix: requested || undefined,
          provider: channel.provider,
        });
        toast.success(t('identity.provision.success', { identifier: account.identifier }));
        await onChanged();
        return account;
      } catch (error) {
        console.error('[AgentIdentity] provision failed', error);
        toast.error(
          t('identity.provision.failed', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
        return undefined;
      }
    },
    [agentId, onChanged, t],
  );

  const release = useCallback(
    (account: AgentAccountView) =>
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('identity.release.content', { identifier: account.identifier }),
        okButtonProps: { danger: true },
        okText: t('identity.release.confirm'),
        onOk: async () => {
          try {
            await agentAccountService.revoke(account.id);
            toast.success(t('identity.release.success'));
            await onChanged();
          } catch (error) {
            console.error('[AgentIdentity] release failed', error);
            toast.error(t('identity.release.failed'));
          }
        },
        title: t('identity.release.title'),
      }),
    [onChanged, t],
  );

  return { provision, release };
};

export interface UseInboxActionsParams {
  agentId: string;
  /** Revalidate the inbox after its read state changes. */
  onChanged: () => Promise<unknown> | void;
}

/** Reading the inbox: open one message, or clear the unread marks. */
export const useInboxActions = ({ agentId, onChanged }: UseInboxActionsParams) => {
  const { t } = useTranslation('setting');

  const openMessage = useCallback(
    async (message: AgentInboxMessage) => {
      openMessageModal(message.id);

      // Already read: opening it again must not re-stamp `readAt`.
      if (message.readAt) return;

      try {
        await agentAccountService.markInboxRead([message.id]);
        await onChanged();
      } catch (error) {
        // The message is already open; a failed read-mark only affects the dot.
        console.error('[AgentIdentity] mark read failed', error);
      }
    },
    [onChanged],
  );

  const markAllRead = useCallback(async () => {
    try {
      await agentAccountService.markAllInboxRead(agentId);
      await onChanged();
    } catch (error) {
      console.error('[AgentIdentity] mark all read failed', error);
      toast.error(t('identity.inbox.markAllReadFailed'));
    }
  }, [agentId, onChanged, t]);

  return { markAllRead, openMessage };
};

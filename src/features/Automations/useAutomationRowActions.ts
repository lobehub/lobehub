import { agentDisplayName, type InboundWebhookItem } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { inboundWebhookService } from '@/services/inboundWebhook';

import {
  type CheckFeedback,
  feedbackForCheckedItem,
  feedbackForCheckError,
  feedbackForDeleteError,
} from './checkFeedback';
import { openRenameAutomationModal } from './RenameAutomationModal';

export interface AutomationRowCallbacks {
  /** The server answered a check or a rename with this row; put it in place. */
  onChecked: (item: InboundWebhookItem) => void;
  /** The row no longer exists on the server; drop it. */
  onRemoved: (id: string) => void;
}

/**
 * Check and delete for one row. State lives per row, so a check in flight on
 * one subscription leaves the others usable.
 *
 * - Check: the refreshed row replaces the old one; the toast says the
 *   subscription is healthy or names the problem the check found. A refusal
 *   (too soon, gone, not allowed) has its own message; a row that is gone is
 *   dropped.
 * - Delete: a danger confirmation naming what stops. A failure keeps the
 *   dialog open (the thrown error is what keeps it) so the user can retry; a
 *   row someone already deleted just leaves the list.
 */
export const useAutomationRowActions = (
  item: InboundWebhookItem,
  { onChecked, onRemoved }: AutomationRowCallbacks,
) => {
  const { t } = useTranslation(['setting', 'chat']);
  const [checking, setChecking] = useState(false);

  const notify = (feedback: CheckFeedback) => {
    const message = t(feedback.key as any, {
      reason: feedback.reasonKey ? t(feedback.reasonKey as any) : undefined,
    });
    toast[feedback.type](message);
  };

  const check = async () => {
    setChecking(true);
    try {
      const next = await inboundWebhookService.check(item.id);
      onChecked(next);
      notify(feedbackForCheckedItem(next));
    } catch (error) {
      const feedback = feedbackForCheckError(error);
      notify(feedback);
      if (feedback.refresh) onRemoved(item.id);
    } finally {
      setChecking(false);
    }
  };

  // The event it follows: fixed, and what the agent knows it by.
  const event = item.source.kind === 'mcp_events' ? item.source.eventName : item.identifier;

  const confirmDelete = () =>
    confirmModal({
      cancelText: t('automations.delete.cancel'),
      content: t('automations.delete.content', {
        agent: agentDisplayName(item.agent, t('untitledAgent', { ns: 'chat' })),
        connector: item.connector?.name ?? event,
        event,
      }),
      okButtonProps: { danger: true },
      okText: t('automations.delete.ok'),
      onOk: async () => {
        try {
          await inboundWebhookService.delete(item.id);
          onRemoved(item.id);
        } catch (error) {
          const feedback = feedbackForDeleteError(error);
          notify(feedback);
          if (feedback.refresh) onRemoved(item.id);
          else throw error;
        }
      },
      title: t('automations.delete.title'),
    });

  /**
   * The name people see; the event it follows stays what the agent knows it by. Only its
   * creator renames it, as only they change what it runs.
   */
  const canRename = item.canConfigure;

  const rename = () =>
    openRenameAutomationModal({
      currentName: item.name ?? '',
      fallback: event,
      onSubmit: async (name) => {
        try {
          onChecked(await inboundWebhookService.update(item.id, { name }));
          toast.success(t('automations.rename.done'));
          return undefined;
        } catch {
          return t('automations.rename.failed');
        }
      },
    });

  return { canRename, check, checking, confirmDelete, rename };
};

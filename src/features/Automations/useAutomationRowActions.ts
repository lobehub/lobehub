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

export interface AutomationRowCallbacks {
  /** The server answered a check with this row; put it in place. */
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

  const confirmDelete = () =>
    confirmModal({
      cancelText: t('automations.delete.cancel'),
      content: t('automations.delete.content', {
        agent: agentDisplayName(item.agent, t('untitledAgent', { ns: 'chat' })),
        connector: item.connector?.name ?? item.source.eventName,
        event: item.source.eventName,
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

  return { check, checking, confirmDelete };
};

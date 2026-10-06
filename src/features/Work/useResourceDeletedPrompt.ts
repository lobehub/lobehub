import type { WorkListBaseItem } from '@lobechat/types';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useRemoveWork, type UseRemoveWorkOptions } from './useRemoveWork';

/**
 * i18n key for the "resource deleted" title, worded per Work type so the user
 * learns *what* is gone (the task / the document), not just that the card is
 * an orphan.
 */
const resourceDeletedKey = (item: Pick<WorkListBaseItem, 'type'>) => {
  switch (item.type) {
    case 'document': {
      return 'workingPanel.works.documentDeleted';
    }
    case 'task': {
      return 'workingPanel.works.taskDeleted';
    }
    default: {
      return 'workingPanel.works.resourceDeleted';
    }
  }
};

/**
 * Click handler for an orphaned Work: the backing resource was deleted outside
 * the tool path, so the card renders from its snapshot and opening it would
 * 404. The card deliberately looks like any other card — a persistent badge
 * taxed every surface for a rare state — and only explains itself when the
 * user actually tries to open it.
 *
 * The explanation is the removal confirm itself, not a toast: the one thing a
 * user can still do with a card that no longer opens is clear it, and a
 * corner toast is both far from where they clicked and gone before they can
 * act on it. Cancel keeps the card. Callers gate on `item.resourceDeleted` and
 * call this instead of their open handler.
 */
export const useResourceDeletedPrompt = (options: UseRemoveWorkOptions = {}) => {
  const { t } = useTranslation('chat');
  const removeWork = useRemoveWork(options);

  return useCallback(
    (item: Pick<WorkListBaseItem, 'id' | 'type'>) => {
      removeWork(item, {
        content: t('workingPanel.works.resourceDeletedRemoveConfirm'),
        title: t(resourceDeletedKey(item)),
      });
    },
    [removeWork, t],
  );
};

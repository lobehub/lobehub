import type { WorkListBaseItem } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { workService } from '@/services/work';

/**
 * User-initiated removal of a Work card. Intended for orphaned Works (the
 * backing task / document is gone, so the user cannot clear the card by
 * deleting the resource itself). Confirms first because the
 * delete cascades the Work's version history and any project pins.
 */
export interface UseRemoveWorkOptions {
  /**
   * Called after the Work is deleted and the global Work caches are refreshed.
   * Lists backed by `useSWRInfinite` (e.g. the resource-page gallery) need
   * this: SWR's filter-form `mutate` skips their `$inf$` cache keys, so the
   * global refresh below never reaches them and the card would linger until a
   * reload — the owner passes its bound `mutate` here instead.
   */
  onRemoved?: () => void | Promise<void>;
}

/**
 * Per-call copy for the confirm dialog. The default asks a plain "remove this
 * card?"; an entry point that already knows *why* the card is being removed
 * (e.g. the user just tried to open an orphan) leads with that instead.
 */
interface RemoveWorkPrompt {
  content: string;
  title: string;
}

export const useRemoveWork = ({ onRemoved }: UseRemoveWorkOptions = {}) => {
  const { t } = useTranslation(['chat', 'common']);

  return useCallback(
    (item: Pick<WorkListBaseItem, 'id'>, prompt?: RemoveWorkPrompt) => {
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: prompt?.content ?? t('workingPanel.works.removeConfirm', { ns: 'chat' }),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          try {
            await workService.deleteWork(item.id);
            // The orphan may be surfaced in the gallery, the sidebar and any
            // message it was registered from, so refresh every Work view.
            await workService.refreshAllConversations();
            await onRemoved?.();
          } catch (error) {
            console.error('[useRemoveWork] failed to delete work', error);
            toast.error(t('operationFailed', { ns: 'common' }));
          }
        },
        title: prompt?.title ?? t('workingPanel.works.remove', { ns: 'chat' }),
      });
    },
    [onRemoved, t],
  );
};

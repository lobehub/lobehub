import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { useAcceptanceBundle } from '@/features/Acceptance/hooks';
import { openAcceptanceDeleteConfirm } from '@/features/Acceptance/Workspace/AcceptanceDeleteConfirm';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey, verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';
import { useChatStore } from '@/store/chat';

import { useAcceptancePageUrl } from './usePageUrl';

export const useAcceptanceMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation('verify');
  const { acceptanceId, pageUrl } = useAcceptancePageUrl();
  // Same SWR key as the title and body, so this shares their request.
  const { data } = useAcceptanceBundle(acceptanceId ?? null);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const { allowed: canEdit } = usePermission('edit_own_content');

  if (!acceptanceId) return;

  // Rename and delete are the owner's: a shared acceptance opens read-only.
  const canManage = canEdit && data?.isOwner === true;

  const title = data?.subject.title || t('acceptance.titleFallback');
  // The workspace list shows the same title, so a rename refreshes both.
  const refreshAll = () =>
    Promise.all([
      globalMutate(verifyKeys.acceptanceBundle(acceptanceId)),
      globalMutate(isAcceptanceListKey),
    ]);

  return {
    copyId: acceptanceId,
    copyLink: pageUrl,
    delete: canManage
      ? () =>
          openAcceptanceDeleteConfirm({
            ids: [acceptanceId],
            onDelete: async (purge) => {
              await verifyService.deleteAcceptance(acceptanceId, purge);
              // Close the panel first: the bundle it shows no longer exists.
              clearPortalStack();
              await globalMutate(isAcceptanceListKey);
              toast.success(t('acceptance.workspace.deleteSuccess'));
            },
            title,
          })
      : undefined,
    refresh: () => globalMutate(verifyKeys.acceptanceBundle(acceptanceId)),
    rename: canManage
      ? () =>
          openRenameModal({
            defaultValue: title,
            description: t('acceptance.workspace.renameModal.description'),
            onSave: async (next) => {
              try {
                await verifyService.renameAcceptance(acceptanceId, next);
                await refreshAll();
                toast.success(t('acceptance.workspace.renameSuccess'));
              } catch (error) {
                console.error('[acceptance:rename]', error);
                toast.error(t('acceptance.workspace.renameError'));
                // The shared modal closes on a resolved save; re-throw so the
                // typed title survives for a retry.
                throw error;
              }
            },
            title: t('acceptance.workspace.actions.rename'),
          })
      : undefined,
  };
};

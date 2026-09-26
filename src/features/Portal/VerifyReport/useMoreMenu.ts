import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { useVerifyReportBundle } from '@/features/Acceptance/hooks';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useVerifyReportUrl } from './useReportUrl';

export const useVerifyReportMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation('verify');
  const { reportUrl, runId } = useVerifyReportUrl();
  // Same SWR key as the title and body, so this shares their request.
  const { data } = useVerifyReportBundle(runId ?? null);
  const { allowed: canEdit } = usePermission('edit_own_content');

  if (!runId) return;

  const refresh = () => globalMutate(verifyKeys.reportBundle(runId));

  return {
    copyId: runId,
    copyLink: reportUrl,
    refresh,
    rename:
      canEdit && data
        ? () =>
            openRenameModal({
              defaultValue: data.run.title ?? '',
              onSave: async (next) => {
                try {
                  await verifyService.updateRunTitle(runId, next);
                  await Promise.all([
                    refresh(),
                    globalMutate(
                      (key) => Array.isArray(key) && key[0] === verifyKeys.reportSummaries.root,
                    ),
                  ]);
                  toast.success(t('workspace.renameSuccess'));
                } catch (error) {
                  console.error('[verify-report:rename]', error);
                  toast.error(t('workspace.renameError'));
                  // Keep the modal open with the typed title for a retry.
                  throw error;
                }
              },
            })
        : undefined,
  };
};

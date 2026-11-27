import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { downloadFile } from '@lobechat/utils/client';
import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { cloudSandboxService } from '@/services/cloudSandbox';

/**
 * Saves one file out of a conversation's temporary sandbox. The sandbox is
 * discarded after use, so the file is first exported to the user's storage —
 * the same export the agent's `exportFile` tool uses — and downloaded from
 * there. Copying it out takes a moment, so the toast says so until it lands.
 */
export const useSandboxFileDownload = (topicId: string | undefined) => {
  const { t } = useTranslation('chat');

  return useCallback(
    async (entry: ProjectFileIndexEntry) => {
      if (!topicId) return;

      const pending = toast.loading(
        t('workingPanel.files.download.preparing', { name: entry.name }),
      );
      try {
        const result = await cloudSandboxService.exportAndUploadFile(
          entry.path,
          entry.name,
          topicId,
        );
        if (!result.success || !result.url) {
          throw new Error(result.error?.message || 'Export failed');
        }

        await downloadFile(result.url, entry.name);
      } catch {
        toast.error(t('workingPanel.files.download.failed', { name: entry.name }));
      } finally {
        pending.close();
      }
    },
    [t, topicId],
  );
};

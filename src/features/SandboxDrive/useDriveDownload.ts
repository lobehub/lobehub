import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { describeError } from '@/features/EnvironmentManager/errorMessage';
import { useSingleton } from '@/hooks/useSingleton';
import { sandboxStorageService } from '@/services/sandboxStorage';

/** Follows a link whose response is an attachment, which the browser saves. */
const saveFromUrl = (url: string, fileName: string) => {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};

/**
 * Downloads one entry of a drive: a file as it is, a folder as a zip.
 *
 * The server packs it in a sandbox session — seconds on a cold start or a
 * large folder — and answers with a link that downloads as an attachment, so
 * following it saves the file; nothing is fetched into memory, which a large
 * archive would not survive. Progress shows until the link is ready, and a
 * refusal is said in a sentence, not a code.
 *
 * A second click on an entry still being prepared is ignored: each one starts
 * a sandbox command and an upload of up to a gigabyte.
 */
export const useDriveDownload = (drive: SandboxDrive) => {
  const { t } = useTranslation('setting');
  const inFlight = useSingleton(() => new Set<string>());

  return useCallback(
    async (entry: { name: string; path: string }) => {
      if (inFlight.has(entry.path)) return;
      inFlight.add(entry.path);

      const pending = toast.loading(t('drive.explorer.downloadPreparing', { name: entry.name }));
      try {
        const { fileName, url } = await sandboxStorageService.prepareDownload({
          drive,
          path: entry.path,
        });
        saveFromUrl(url, fileName);
      } catch (error) {
        toast.error(describeError(error, t, t('drive.explorer.downloadFailed')));
      } finally {
        inFlight.delete(entry.path);
        pending.close();
      }
    },
    [drive, inFlight, t],
  );
};

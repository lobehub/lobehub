import { toast } from '@lobehub/ui';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { configService } from '@/services/config';

/**
 * Runs the full data export with visible progress and result feedback.
 *
 * The server builds the whole export before the download starts, which can take
 * minutes for large accounts. Without this state the export button looked dead,
 * so users clicked it repeatedly or assumed it was broken.
 */
export const useExportAllData = () => {
  const { t } = useTranslation('setting');
  const [exporting, setExporting] = useState(false);
  /** Guards against a second click starting a parallel export before the re-render lands. */
  const runningRef = useRef(false);

  const exportAll = useCallback(async () => {
    if (runningRef.current) return;

    runningRef.current = true;
    setExporting(true);

    try {
      await configService.exportAll();
      toast.success(t('storage.actions.export.success'));
    } catch (error) {
      console.error('[exportAll] failed:', error);
      toast.error(t('storage.actions.export.error'));
    } finally {
      runningRef.current = false;
      setExporting(false);
    }
  }, [t]);

  return { exportAll, exporting };
};

import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { configService } from '@/services/config';

/**
 * Runs the full data export and tracks whether it is still running.
 *
 * A full export can take tens of seconds. Exposing `exporting` lets the button show progress and
 * block further clicks, and failures are reported here: without this feedback users clicked again
 * and again, and every click read the whole account from the database once more.
 */
export const useExportAllData = () => {
  const { t } = useTranslation('setting');
  const [exporting, setExporting] = useState(false);

  const exportAllData = async () => {
    setExporting(true);
    try {
      await configService.exportAll();
    } catch {
      // The lambda client only logs 5xx errors to the console, so without this toast a failed
      // export looks like a click that did nothing.
      toast.error(t('storage.actions.export.error'));
    } finally {
      setExporting(false);
    }
  };

  return { exportAllData, exporting };
};

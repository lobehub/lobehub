import type { DiagnosticsBundleResult } from '@lobechat/electron-client-ipc';
import { toast } from '@lobehub/ui';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { desktopSettingsService } from '@/services/electron/settings';

/**
 * Desktop: writes the diagnostics zip and selects it in Finder / Explorer. Shared by
 * Settings → About → Diagnostics and the feedback dialog; the returned `result`
 * lets the caller show which file to attach.
 */
export const useExportDiagnostics = () => {
  const { t } = useTranslation('common');
  const inFlightRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<DiagnosticsBundleResult>();

  const exportDiagnostics = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setExporting(true);
    try {
      const next = await desktopSettingsService.exportDiagnostics();
      setResult(next);
      toast.success({
        description: t('diagnostics.export.successDesc', { fileName: next.fileName }),
        title: t('diagnostics.export.success'),
      });
    } catch (error) {
      console.error('[Diagnostics] export failed', error);
      toast.error(t('diagnostics.export.failed'));
    } finally {
      inFlightRef.current = false;
      setExporting(false);
    }
  }, [t]);

  return { exportDiagnostics, exporting, result };
};

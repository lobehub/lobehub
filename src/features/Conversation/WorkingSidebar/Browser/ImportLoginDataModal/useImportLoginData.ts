import type {
  BrowserLoginDataPreviewResult,
  BrowserLoginDataSource,
  BrowserSidebarImportResult,
} from '@lobechat/electron-client-ipc';
import { useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { electronBrowserSidebarService } from '@/services/electron/browserSidebar';

export type BrowserLoginDataScope = 'all' | 'selected';

/**
 * Drives the import dialog: previews the hosts available in the chosen browser
 * profile, then imports either every host or the selected ones.
 */
export const useImportLoginData = (onImported?: (result: BrowserSidebarImportResult) => void) => {
  const [source, setSourceState] = useState<BrowserLoginDataSource>('edge');
  const [scope, setScope] = useState<BrowserLoginDataScope>('all');
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<BrowserSidebarImportResult>();

  const {
    data,
    error,
    isLoading,
    mutate: retryPreview,
  } = useClientDataSWR(
    ['browser-login-data-preview', source],
    () => electronBrowserSidebarService.previewBrowserLoginData({ source }),
    { revalidateOnFocus: false },
  );
  // A rejected IPC call (e.g. the main process went away) still needs a readable error.
  const preview: BrowserLoginDataPreviewResult | undefined =
    data ?? (error ? { domains: [], errorCode: 'unknown', success: false } : undefined);

  const domains = preview?.domains ?? [];
  const canImport =
    !!preview?.success &&
    domains.length > 0 &&
    (scope === 'all' || selectedDomains.length > 0) &&
    !isImporting &&
    !result?.success;

  const setSource = (next: BrowserLoginDataSource) => {
    setSourceState(next);
    setSelectedDomains([]);
    setResult(undefined);
  };

  const runImport = async () => {
    if (!canImport) return;
    setIsImporting(true);
    try {
      const next = await electronBrowserSidebarService.importBrowserLoginData({
        domains: scope === 'selected' ? selectedDomains : undefined,
        source,
      });
      setResult(next);
      if (next.success && next.importedCount > 0) onImported?.(next);
    } catch {
      setResult({ errorCode: 'unknown', importedCount: 0, success: false });
    } finally {
      setIsImporting(false);
    }
  };

  return {
    canImport,
    domains,
    isImporting,
    isPreviewLoading: isLoading || !preview,
    preview,
    result,
    retryPreview,
    runImport,
    scope,
    selectedDomains,
    setScope,
    setSelectedDomains,
    setSource,
    source,
  };
};

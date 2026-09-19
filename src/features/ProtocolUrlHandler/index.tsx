'use client';

import type { ProviderImportPreview, ProviderImportRequest } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';

import { type McpInstallRequest } from '@/features/ProtocolUrlHandler/InstallPlugin/types';
import { useSingleton } from '@/hooks/useSingleton';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import PluginInstallConfirmModal from './InstallPlugin';
import { createProviderImportModal } from './ProviderImport';

const providerImportErrorKeys = {
  callback_failed: 'providerImport.error.callback_failed',
  invalid_callback: 'providerImport.error.invalid_callback',
  invalid_payload: 'providerImport.error.invalid_payload',
} as const;

const ProtocolUrlHandler = () => {
  const [installRequest, setInstallRequest] = useState<McpInstallRequest | null>(null);
  const handledProviderImportIds = useSingleton(() => new Set<string>());

  const handleMcpInstallRequest = useCallback(
    (data: { marketId?: string; pluginId: string; schema: any }) => {
      // Pass raw data to child component for processing
      setInstallRequest(data as McpInstallRequest);
    },
    [],
  );

  const handleComplete = useCallback(() => {
    setInstallRequest(null);
  }, []);

  const showProviderImport = useCallback(
    (preview: ProviderImportPreview) => {
      if (handledProviderImportIds.has(preview.requestId)) return;
      handledProviderImportIds.add(preview.requestId);

      void createProviderImportModal(preview).catch((error) => {
        console.error('Failed to prepare provider import', error);
        void ensureElectronIpc().providerImport.cancel(preview.requestId);
        toast.error(t('providerImport.error.apply', { ns: 'modelProvider' }));
      });
    },
    [handledProviderImportIds],
  );

  const handleProviderImportRequest = useCallback(
    (request: ProviderImportRequest) => {
      if (request.status === 'error') {
        if (handledProviderImportIds.has(request.requestId)) return;
        handledProviderImportIds.add(request.requestId);
        void ensureElectronIpc().providerImport.cancel(request.requestId);
        toast.error(t(providerImportErrorKeys[request.errorCode], { ns: 'modelProvider' }));
        return;
      }

      showProviderImport(request.preview);
    },
    [handledProviderImportIds, showProviderImport],
  );

  useWatchBroadcast('mcpInstallRequest', handleMcpInstallRequest);
  useWatchBroadcast('providerImportRequest', handleProviderImportRequest);

  useEffect(() => {
    let active = true;

    void ensureElectronIpc()
      .providerImport.listPending()
      .then((requests: ProviderImportRequest[]) => {
        if (active) requests.forEach(handleProviderImportRequest);
      })
      .catch((error: unknown) => {
        console.error('Failed to list pending provider imports', error);
      });

    return () => {
      active = false;
    };
  }, [handleProviderImportRequest]);

  return <PluginInstallConfirmModal installRequest={installRequest} onComplete={handleComplete} />;
};

export default ProtocolUrlHandler;

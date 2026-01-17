'use client';

import { memo, useEffect } from 'react';

import { getDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import { useElectronStore } from '@/store/electron';
import {
  getDesktopAutoOidcFirstOpenHandled,
  setDesktopAutoOidcFirstOpenHandled,
} from '@/utils/electron/autoOidc';

/**
 * Desktop-only bootstrap: auto invoke OIDC authorization on the very first app open.
 *
 * Note: we intentionally keep this outside of `Connection` UI to avoid coupling business flow to UI.
 */
const DesktopAutoOidcOnFirstOpen = memo(() => {
  const [isInitRemoteServerConfig, dataSyncConfig, useDataSyncConfig, connectRemoteServer] =
    useElectronStore((s) => [
      s.isInitRemoteServerConfig,
      s.dataSyncConfig,
      s.useDataSyncConfig,
      s.connectRemoteServer,
    ]);

  // Ensure config is loaded early.
  useDataSyncConfig();

  useEffect(() => {
    if (!isInitRemoteServerConfig) return;

    // Don't auto-trigger during onboarding flow.
    if (!getDesktopOnboardingCompleted()) return;

    // If already connected or not in cloud mode, don't auto-trigger.
    if (dataSyncConfig.active) return;
    if (dataSyncConfig.storageMode !== 'cloud') return;

    if (getDesktopAutoOidcFirstOpenHandled()) return;
    // If localStorage is unavailable, don't auto-invoke to avoid repeated prompts.
    if (!setDesktopAutoOidcFirstOpenHandled()) return;

    // This will trigger IPC -> main process -> `shell.openExternal(/oidc/auth...)`.
    connectRemoteServer({ remoteServerUrl: dataSyncConfig.remoteServerUrl, storageMode: 'cloud' });
  }, [
    connectRemoteServer,
    dataSyncConfig.active,
    dataSyncConfig.remoteServerUrl,
    dataSyncConfig.storageMode,
    isInitRemoteServerConfig,
  ]);

  return null;
});

export default DesktopAutoOidcOnFirstOpen;

import { isOfficialCloudServer, OFFICIAL_URL } from '@lobechat/const';

import { type ElectronState } from '../initialState';

const isSyncActive = (s: ElectronState) => s.dataSyncConfig.active ?? false;

const storageMode = (s: ElectronState) => s.dataSyncConfig.storageMode;

/**
 * Returns the effective remote server URL based on storage mode:
 * - Cloud mode: returns the cloud this build talks to
 * - SelfHost mode: returns the configured remoteServerUrl
 *
 * This is what every "copy link" action renders, so it has to name the same
 * host the app is actually signed in to. The main process resolves cloud mode
 * through `OFFICIAL_CLOUD_SERVER` (RemoteServerConfigCtr.getRemoteServerUrl),
 * and pinning `OFFICIAL_URL` here instead meant a build configured for another
 * deployment fetched its data from one host and handed the user links to
 * another — links that 404 for anyone who opens them.
 *
 * Undefined outside the desktop renderer, where the fallback is the right
 * answer anyway: the web app reads `window.location.origin` and never gets here.
 */
const remoteServerUrl = (s: ElectronState) =>
  s.dataSyncConfig.storageMode === 'cloud'
    ? process.env.OFFICIAL_CLOUD_SERVER || OFFICIAL_URL
    : s.dataSyncConfig.remoteServerUrl || '';

/**
 * Returns the raw remoteServerUrl from config without transformation.
 * Use this when you need the original configured value (e.g., for editing forms).
 */
const rawRemoteServerUrl = (s: ElectronState) => s.dataSyncConfig.remoteServerUrl || '';

const isOfficialServer = (s: ElectronState) => isOfficialCloudServer(remoteServerUrl(s));

export const electronSyncSelectors = {
  isOfficialServer,
  isSyncActive,
  rawRemoteServerUrl,
  remoteServerUrl,
  storageMode,
};

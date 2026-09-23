import path from 'node:path';

import { OFFICIAL_CLOUD_URL, OFFICIAL_URL } from '@lobechat/const/url';
import { BrowserWindow } from 'electron';

import { preloadDir } from '@/const/dir';
import { createLogger } from '@/utils/logger';
import { CONNECTOR_OAUTH_RESULT_CHANNEL, type ConnectorOAuthResult } from '~common/connectorOAuth';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:ConnectorOAuthCtr');

export default class ConnectorOAuthCtr extends ControllerModule {
  static override readonly groupName = 'connectorOAuth';

  @IpcMethod()
  async authorize(params: {
    authorizationUrl: string;
    connectorId: string;
  }): Promise<ConnectorOAuthResult> {
    const authorizationUrl = new URL(params.authorizationUrl);
    const remoteUrl = await this.app.getController(RemoteServerConfigCtr).getRemoteServerUrl();
    const remoteOrigin = new URL(remoteUrl).origin;
    // Official API and app origins differ; self-hosted servers trust only their own origin.
    const callbackOrigins = [OFFICIAL_CLOUD_URL, OFFICIAL_URL].includes(remoteOrigin)
      ? [OFFICIAL_CLOUD_URL, OFFICIAL_URL]
      : [remoteOrigin];
    const callbackUrl = callbackOrigins
      .map((origin) => new URL('/oauth/connector/callback', origin))
      .find((url) => url.href === authorizationUrl.searchParams.get('redirect_uri'));
    const state = authorizationUrl.searchParams.get('state');
    if (!['https:', 'http:'].includes(authorizationUrl.protocol) || !callbackUrl || !state) {
      return 'failed';
    }

    const parent = this.app.browserManager.getMainWindow().browserWindow;
    const popup = new BrowserWindow({
      autoHideMenuBar: true,
      height: 720,
      parent,
      title: 'Connector authorization',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'connector-oauth',
        preload: path.join(preloadDir, 'connectorOAuth.js'),
        sandbox: true,
        webviewTag: false,
      },
      width: 600,
    });

    // Keep third-party content out of the desktop's authenticated session and
    // deny local navigation, nested windows, and device permission requests.
    popup.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    popup.webContents.session.setPermissionCheckHandler(() => false);
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (!['https:', 'http:'].includes(new URL(url).protocol)) event.preventDefault();
    };
    popup.webContents.on('will-navigate', guardNavigation);
    popup.webContents.on('will-redirect', guardNavigation);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ConnectorOAuthResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        parent.removeListener('closed', onParentClosed);
        if (!popup.isDestroyed()) popup.destroy();
        resolve(result);
      };
      const onParentClosed = () => finish('dismissed');
      const timer = setTimeout(() => finish('timeout'), 5 * 60_000);
      parent.once('closed', onParentClosed);
      popup.once('closed', () => finish('dismissed'));
      popup.webContents.on('render-process-gone', () => finish('failed'));
      popup.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) finish('failed'); // ERR_ABORTED is normal on redirects.
      });
      popup.webContents.ipc.on(CONNECTOR_OAUTH_RESULT_CHANNEL, (event, data) => {
        if (event.senderFrame !== popup.webContents.mainFrame) return;
        const url = new URL(event.senderFrame.url);
        if (
          url.origin !== callbackUrl.origin ||
          url.pathname !== callbackUrl.pathname ||
          url.searchParams.get('state') !== state ||
          data?.type !== 'lobe-connector-oauth' ||
          (data.connectorId && data.connectorId !== params.connectorId)
        )
          return;

        if (data.success === true && data.connectorId === params.connectorId) finish('success');
        else if (data.success === false) finish('failed');
      });
      // Never log this URL: it contains the user's OAuth state and PKCE challenge.
      popup.loadURL(authorizationUrl.href).catch((error: { code?: string }) => {
        if (error.code === 'ERR_ABORTED') return; // The provider navigated before loading finished.
        logger.error('Failed to load connector authorization page');
        finish('failed');
      });
    });
  }
}

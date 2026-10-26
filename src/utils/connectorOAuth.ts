import { isDesktop } from '@lobechat/const';
import type { ConnectorOAuthIpc } from '@lobechat/electron-client-ipc/types';

import { ensureElectronIpc } from '@/utils/electron/ipc';

export class ConnectorOAuthError extends Error {
  constructor(public readonly reason: 'blocked' | 'dismissed' | 'failed' | 'timeout') {
    super(`Connector OAuth ${reason}`);
  }
}

/** Must be called synchronously from the click, before validation or network IO. */
export const openConnectorOAuthPopup = () =>
  isDesktop
    ? undefined
    : window.open('about:blank', 'lobe-connector-oauth', 'width=600,height=720');

/** Navigate and wait for the server callback, not messages from the provider. */
export const waitForConnectorOAuth = async (
  popup: Window | null | undefined,
  connectorId: string,
  authorizationUrl: string,
  signal?: AbortSignal,
): Promise<void> => {
  signal?.throwIfAborted();
  if (isDesktop) {
    // Native ownership survives provider COOP headers that sever window.opener.
    const oauth: ConnectorOAuthIpc = ensureElectronIpc().connectorOAuth;
    const requestId = crypto.randomUUID();
    const onAbort = () => {
      oauth.cancel({ requestId }).catch((error: unknown) => {
        console.error('Failed to cancel native connector authorization', error);
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await oauth.authorize({ authorizationUrl, connectorId, requestId });
      if (signal?.aborted) throw new ConnectorOAuthError('dismissed');
      if (result !== 'success') throw new ConnectorOAuthError(result);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    return;
  }
  if (!popup) throw new ConnectorOAuthError('blocked');

  // The server supplies redirect_uri; only its callback may settle the flow.
  const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri');
  const callbackOrigin = redirectUri ? new URL(redirectUri).origin : window.location.origin;

  return new Promise((resolve, reject) => {
    const finish = (error?: ConnectorOAuthError) => {
      signal?.removeEventListener('abort', onAbort);
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
      clearTimeout(timeout);
      if (!popup.closed) popup.close();
      if (error) reject(error);
      else resolve();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== callbackOrigin || event.source !== popup) return;
      const data = event.data;
      if (!data || data.type !== 'lobe-connector-oauth') return;
      // Early callback failures (e.g. access_denied) have no connector ID.
      if (data.connectorId && data.connectorId !== connectorId) return;
      if (data.success === true && data.connectorId === connectorId) finish();
      else if (data.success === false) finish(new ConnectorOAuthError('failed'));
    };
    const onAbort = () => finish(new ConnectorOAuthError('dismissed'));

    window.addEventListener('message', onMessage);
    const timer = setInterval(() => {
      if (popup.closed) finish(new ConnectorOAuthError('dismissed'));
    }, 800);
    const timeout = setTimeout(() => finish(new ConnectorOAuthError('timeout')), 5 * 60_000);
    signal?.addEventListener('abort', onAbort, { once: true });

    if (popup.closed) {
      finish(new ConnectorOAuthError('dismissed'));
      return;
    }
    try {
      popup.location.href = authorizationUrl;
    } catch {
      finish(new ConnectorOAuthError('failed'));
    }
  });
};

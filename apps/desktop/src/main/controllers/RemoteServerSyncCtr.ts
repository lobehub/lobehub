import { ProxyTRPCStreamRequestParams } from '@lobechat/electron-client-ipc';
import { IpcMainEvent, WebContents, ipcMain } from 'electron';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Buffer } from 'node:buffer';
import http, { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

import { defaultProxySettings } from '@/const/store';
import { createLogger } from '@/utils/logger';

import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import { ControllerModule } from './index';

// Create logger
const logger = createLogger('controllers:RemoteServerSyncCtr');

/**
 * Remote Server Sync Controller
 * For handling data synchronization with remote servers via IPC.
 */
export default class RemoteServerSyncCtr extends ControllerModule {
  static override readonly groupName = 'remoteServerSync';
  /**
   * Cached instance of RemoteServerConfigCtr
   */
  private _remoteServerConfigCtrInstance: RemoteServerConfigCtr | null = null;

  /**
   * Remote server configuration controller
   */
  private get remoteServerConfigCtr() {
    if (!this._remoteServerConfigCtrInstance) {
      this._remoteServerConfigCtrInstance = this.app.getController(RemoteServerConfigCtr);
    }
    return this._remoteServerConfigCtrInstance;
  }

  /**
   * Controller initialization - No specific logic needed here now for request handling
   */
  afterAppReady() {
    logger.info('RemoteServerSyncCtr initialized (IPC based)');
    // No need to register protocol handler anymore
    ipcMain.on('stream:start', this.handleStreamRequest);
  }

  /**
   * Handle IPC calls for streaming requests
   */
  private handleStreamRequest = async (event: IpcMainEvent, args: ProxyTRPCStreamRequestParams) => {
    const { requestId } = args;
    const logPrefix = `[StreamProxy ${args.method} ${args.urlPath}][${requestId}]`;
    logger.debug(`${logPrefix} Received stream:start IPC call`);

    try {
      const config = await this.remoteServerConfigCtr.getRemoteServerConfig();
      if (!config.active || (config.storageMode === 'selfHost' && !config.remoteServerUrl)) {
        logger.warn(`${logPrefix} Remote server sync not active or configured.`);
        event.sender.send(
          `stream:error:${requestId}`,
          new Error('Remote server sync not active or configured'),
        );
        return;
      }

      const remoteServerUrl = await this.remoteServerConfigCtr.getRemoteServerUrl();
      const token = await this.remoteServerConfigCtr.getAccessToken();

      if (!token) {
        // 401 Unauthorized
        event.sender.send(`stream:response:${requestId}`, {
          headers: {},
          status: 401,
          statusText: 'Authentication required, missing token',
        });
        event.sender.send(`stream:end:${requestId}`);
        return;
      }

      // Call new streaming forwarding method
      await this.forwardStreamRequest(event.sender, {
        ...args,
        accessToken: token,
        remoteServerUrl,
      });
    } catch (error) {
      logger.error(`${logPrefix} Unhandled error processing stream request:`, error);
      event.sender.send(
        `stream:error:${requestId}`,
        error instanceof Error ? error : new Error('Unknown error'),
      );
    }
  };

  /**
   * Execute actual streaming request forwarding
   */
  private async forwardStreamRequest(
    sender: WebContents,
    args: ProxyTRPCStreamRequestParams & { accessToken: string; remoteServerUrl: string },
  ) {
    const {
      urlPath,
      method,
      headers: originalHeaders,
      body: requestBody,
      accessToken,
      remoteServerUrl,
      requestId,
    } = args;
    const targetUrl = new URL(urlPath, remoteServerUrl);
    const logPrefix = `[ForwardStream ${method} ${targetUrl.pathname}][${requestId}]`;

    const { requestOptions, requester } = this.createRequester({
      accessToken,
      headers: originalHeaders,
      method,
      url: targetUrl,
    });

    const clientReq = requester.request(requestOptions, (clientRes: IncomingMessage) => {
      logger.debug(`${logPrefix} Received response with status ${clientRes.statusCode}`);

      // Add debug information
      logger.debug(`${logPrefix} Response details:`, {
        headers: clientRes.headers,
        statusCode: clientRes.statusCode,
        statusMessage: clientRes.statusMessage,
      });

      // 1. Immediately send response headers and status code
      const responseData = {
        headers: clientRes.headers || {},
        status: clientRes.statusCode || 500,
        statusText: clientRes.statusMessage || 'Unknown Status',
      };

      logger.debug(`${logPrefix} Sending response data:`, responseData);
      sender.send(`stream:response:${requestId}`, responseData);

      // 2. Listen for data chunks and forward
      clientRes.on('data', (chunk: Buffer) => {
        if (sender.isDestroyed()) return;
        logger.debug(`${logPrefix} Received data chunk, size: ${chunk.length}. Forwarding...`);
        sender.send(`stream:data:${requestId}`, chunk);
      });

      // 3. Listen for end signal and forward
      clientRes.on('end', () => {
        logger.debug(`${logPrefix} Stream ended. Forwarding end signal...`);
        if (sender.isDestroyed()) return;
        sender.send(`stream:end:${requestId}`);
      });

      // 4. Listen for response stream errors and forward
      clientRes.on('error', (error) => {
        logger.error(`${logPrefix} Error reading response stream:`, error);
        if (sender.isDestroyed()) return;
        sender.send(`stream:error:${requestId}`, error);
      });
    });

    // 5. Listen for request errors (e.g., DNS resolution failure)
    clientReq.on('error', (error) => {
      logger.error(`${logPrefix} Error forwarding request:`, error);
      if (sender.isDestroyed()) return;
      sender.send(`stream:error:${requestId}`, error);
    });

    if (requestBody) {
      clientReq.write(Buffer.from(requestBody as string));
    }

    clientReq.end();
  }

  private createRequester({
    headers,
    accessToken,
    method,
    url,
  }: {
    accessToken: string;
    headers: Record<string, string>;
    method: string;
    url: URL;
  }) {
    // Prepare headers, cloning and adding Oidc-Auth
    const requestHeaders: OutgoingHttpHeaders = { ...headers }; // Use OutgoingHttpHeaders
    requestHeaders['Oidc-Auth'] = accessToken;

    // Let node handle Host, Content-Length etc. Remove potentially problematic headers
    delete requestHeaders['host'];
    delete requestHeaders['connection']; // Often causes issues
    // delete requestHeaders['content-length']; // Let node handle it based on body

    // Read proxy configuration
    const proxyConfig = this.app.storeManager.get('networkProxy', defaultProxySettings);

    let agent;
    if (proxyConfig?.enableProxy && proxyConfig.proxyServer) {
      const proxyUrl = `${proxyConfig.proxyType}://${proxyConfig.proxyServer}${proxyConfig.proxyPort ? `:${proxyConfig.proxyPort}` : ''}`;
      agent =
        url.protocol === 'https:' ? new HttpsProxyAgent(proxyUrl) : new HttpProxyAgent(proxyUrl);
    }

    const requestOptions: https.RequestOptions | http.RequestOptions = {
      agent,
      // Use union type
      headers: requestHeaders,
      hostname: url.hostname,
      method: method,
      path: url.pathname + url.search,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      protocol: url.protocol,
    };

    const requester = url.protocol === 'https:' ? https : http;
    return { requestOptions, requester };
  }
}

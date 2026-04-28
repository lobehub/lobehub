import { randomUUID } from 'node:crypto';
import os from 'node:os';

import type {
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
} from '@lobechat/device-gateway-client';
import { GatewayClient } from '@lobechat/device-gateway-client';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { app } from 'electron';

import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:GatewayConnectionSrv');

const DEFAULT_GATEWAY_URL = 'https://device-gateway.lobehub.com';

interface ToolCallHandler {
  (apiName: string, args: any): Promise<unknown>;
}

/**
 * GatewayConnectionService
 *
 * Core business logic for managing WebSocket connection to the cloud device-gateway.
 * Extracted from GatewayConnectionCtr so other controllers can reuse connect/disconnect.
 */
export default class GatewayConnectionService extends ServiceModule {
  private client: GatewayClient | null = null;
  private status: GatewayConnectionStatus = 'disconnected';
  private deviceId: string | null = null;

  private tokenProvider: (() => Promise<string | null>) | null = null;
  private tokenRefresher: (() => Promise<{ error?: string; success: boolean }>) | null = null;
  private toolCallHandler: ToolCallHandler | null = null;

  // ─── Configuration ───

  /**
   * Set token provider function (to decouple from RemoteServerConfigCtr)
   */
  setTokenProvider(provider: () => Promise<string | null>) {
    this.tokenProvider = provider;
  }

  /**
   * Set token refresher function (for auth_expired handling)
   */
  setTokenRefresher(refresher: () => Promise<{ error?: string; success: boolean }>) {
    this.tokenRefresher = refresher;
  }

  /**
   * Set tool call handler (to route tool calls to LocalFileCtr/ShellCommandCtr)
   */
  setToolCallHandler(handler: ToolCallHandler) {
    this.toolCallHandler = handler;
  }

  // ─── Device ID ───

  loadOrCreateDeviceId() {
    const stored = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    if (stored) {
      this.deviceId = stored;
    } else {
      this.deviceId = randomUUID();
      this.app.storeManager.set('gatewayDeviceId', this.deviceId);
    }
    logger.debug(`Device ID: ${this.deviceId}`);
  }

  getDeviceId(): string {
    return this.deviceId || 'unknown';
  }

  // ─── Connection Status ───

  getStatus(): GatewayConnectionStatus {
    return this.status;
  }

  getDeviceInfo() {
    return {
      description: this.getDeviceDescription(),
      deviceId: this.getDeviceId(),
      hostname: os.hostname(),
      name: this.getDeviceName(),
      platform: process.platform,
    };
  }

  // ─── Device Name & Description ───

  getDeviceName(): string {
    return (this.app.storeManager.get('gatewayDeviceName') as string) || os.hostname();
  }

  setDeviceName(name: string) {
    this.app.storeManager.set('gatewayDeviceName', name);
  }

  getDeviceDescription(): string {
    return (this.app.storeManager.get('gatewayDeviceDescription') as string) || '';
  }

  setDeviceDescription(description: string) {
    this.app.storeManager.set('gatewayDeviceDescription', description);
  }

  // ─── Connection Logic ───

  async connect(): Promise<{ error?: string; success: boolean }> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return { success: true };
    }
    return this.doConnect();
  }

  async disconnect(): Promise<{ success: boolean }> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.setStatus('disconnected');
    return { success: true };
  }

  private async doConnect(): Promise<{ error?: string; success: boolean }> {
    // Clean up any existing client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenProvider) {
      logger.warn('Cannot connect: no token provider configured');
      return { error: 'No token provider configured', success: false };
    }

    const token = await this.tokenProvider();
    if (!token) {
      logger.warn('Cannot connect: no access token');
      return { error: 'No access token available', success: false };
    }

    const gatewayUrl = this.getGatewayUrl();
    const userId = this.extractUserIdFromToken(token);
    logger.info(`Connecting to device gateway: ${gatewayUrl}, userId: ${userId || 'unknown'}`);

    const client = new GatewayClient({
      deviceId: this.getDeviceId(),
      gatewayUrl,
      logger,
      token,
      userId: userId || undefined,
    });

    this.setupClientEvents(client);
    this.client = client;

    await client.connect();
    return { success: true };
  }

  private setupClientEvents(client: GatewayClient) {
    client.on('status_changed', (status) => {
      this.setStatus(status);
    });

    client.on('tool_call_request', (request) => {
      this.handleToolCallRequest(request, client);
    });

    client.on('system_info_request', (request) => {
      this.handleSystemInfoRequest(client, request);
    });

    client.on('auth_expired', () => {
      logger.warn('Received auth_expired, will reconnect with refreshed token');
      this.handleAuthExpired();
    });

    client.on('error', (error) => {
      logger.error('WebSocket error:', error.message);
    });
  }

  // ─── Auth Expired Handling ───

  private async handleAuthExpired() {
    // Disconnect the current client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenRefresher) {
      logger.error('No token refresher configured, cannot handle auth_expired');
      this.setStatus('disconnected');
      return;
    }

    logger.info('Attempting token refresh before reconnect');
    const result = await this.tokenRefresher();

    if (result.success) {
      logger.info('Token refreshed, reconnecting');
      await this.doConnect();
    } else {
      logger.error('Token refresh failed:', result.error);
      this.setStatus('disconnected');
    }
  }

  // ─── System Info ───

  private handleSystemInfoRequest(client: GatewayClient, request: SystemInfoRequestMessage) {
    logger.info(`Received system_info_request: requestId=${request.requestId}`);
    client.sendSystemInfoResponse({
      requestId: request.requestId,
      result: {
        success: true,
        systemInfo: {
          arch: os.arch(),
          desktopPath: app.getPath('desktop'),
          documentsPath: app.getPath('documents'),
          downloadsPath: app.getPath('downloads'),
          homePath: app.getPath('home'),
          musicPath: app.getPath('music'),
          picturesPath: app.getPath('pictures'),
          userDataPath: app.getPath('userData'),
          videosPath: app.getPath('videos'),
          workingDirectory: process.cwd(),
        },
      },
    });
  }

  // ─── Tool Call Routing ───

  private handleToolCallRequest = async (
    request: ToolCallRequestMessage,
    client: GatewayClient,
  ) => {
    const { requestId, toolCall } = request;
    const { apiName, arguments: argsStr } = toolCall;

    logger.info(`Received tool call: apiName=${apiName}, requestId=${requestId}`);

    try {
      if (!this.toolCallHandler) {
        throw new Error('No tool call handler configured');
      }

      const args = JSON.parse(argsStr);
      const result = await this.toolCallHandler(apiName, args);

      client.sendToolCallResponse({
        requestId,
        result: {
          content: typeof result === 'string' ? result : JSON.stringify(result),
          success: true,
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool call failed: apiName=${apiName}, error=${errorMsg}`);

      client.sendToolCallResponse({
        requestId,
        result: {
          content: errorMsg,
          error: errorMsg,
          success: false,
        },
      });
    }
  };

  // ─── Status Broadcasting ───

  private setStatus(status: GatewayConnectionStatus) {
    if (this.status === status) return;

    logger.info(`Connection status: ${this.status} → ${status}`);
    this.status = status;
    this.app.browserManager.broadcastToAllWindows('gatewayConnectionStatusChanged', { status });
  }

  // ─── Gateway URL ───

  private getGatewayUrl(): string {
    return this.app.storeManager.get('gatewayUrl') || DEFAULT_GATEWAY_URL;
  }

  // ─── Token Helpers ───

  /**
   * Extract userId (sub claim) from JWT without verification.
   * The token will be verified server-side; we just need the userId for routing.
   */
  private extractUserIdFromToken(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload.sub || null;
    } catch {
      logger.warn('Failed to extract userId from JWT token');
      return null;
    }
  }
}

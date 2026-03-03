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

import { ControllerModule, IpcMethod } from './index';
import LocalFileCtr from './LocalFileCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import ShellCommandCtr from './ShellCommandCtr';

const logger = createLogger('controllers:GatewayConnectionCtr');

const DEFAULT_GATEWAY_URL = 'https://device-gateway.lobehub.com';

/**
 * GatewayConnectionCtr
 *
 * Manages WebSocket connection to the cloud device-gateway via shared GatewayClient.
 * Receives tool_call_request messages and routes them to existing
 * LocalFileCtr / ShellCommandCtr methods.
 */
export default class GatewayConnectionCtr extends ControllerModule {
  static override readonly groupName = 'gatewayConnection';

  private client: GatewayClient | null = null;
  private status: GatewayConnectionStatus = 'disconnected';
  private deviceId: string | null = null;

  // ─── Controller Accessors ───

  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  private get localFileCtr() {
    return this.app.getController(LocalFileCtr);
  }

  private get shellCommandCtr() {
    return this.app.getController(ShellCommandCtr);
  }

  // ─── Lifecycle ───

  afterAppReady() {
    this.loadOrCreateDeviceId();
    this.tryAutoConnect();
  }

  // ─── IPC Methods (Renderer → Main) ───

  @IpcMethod()
  async connect(): Promise<{ error?: string; success: boolean }> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return { success: true };
    }
    return this.doConnect();
  }

  @IpcMethod()
  async disconnect(): Promise<{ success: boolean }> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.setStatus('disconnected');
    return { success: true };
  }

  @IpcMethod()
  async getConnectionStatus(): Promise<{ status: GatewayConnectionStatus }> {
    return { status: this.status };
  }

  @IpcMethod()
  async getDeviceInfo(): Promise<{
    deviceId: string;
    hostname: string;
    platform: string;
  }> {
    return {
      deviceId: this.getDeviceId(),
      hostname: os.hostname(),
      platform: process.platform,
    };
  }

  // ─── Connection Logic ───

  private async tryAutoConnect() {
    const isConfigured = await this.remoteServerConfigCtr.isRemoteServerConfigured();
    if (!isConfigured) {
      logger.debug('Remote server not configured, skipping auto-connect');
      return;
    }

    const token = await this.remoteServerConfigCtr.getAccessToken();
    if (!token) {
      logger.debug('No access token, skipping auto-connect');
      return;
    }

    logger.info('Auto-connecting to device gateway');
    await this.doConnect();
  }

  private async doConnect(): Promise<{ error?: string; success: boolean }> {
    // Clean up any existing client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    const token = await this.remoteServerConfigCtr.getAccessToken();
    if (!token) {
      logger.warn('Cannot connect: no access token');
      return { error: 'No access token available', success: false };
    }

    const gatewayUrl = this.getGatewayUrl();
    logger.info(`Connecting to device gateway: ${gatewayUrl}`);

    const client = new GatewayClient({
      deviceId: this.getDeviceId(),
      gatewayUrl,
      logger,
      token,
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
      this.handleToolCallRequest(request);
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

    logger.info('Attempting token refresh before reconnect');
    const result = await this.remoteServerConfigCtr.refreshAccessToken();

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

  private handleToolCallRequest = async (request: ToolCallRequestMessage) => {
    const { requestId, toolCall } = request;
    const { apiName, arguments: argsStr } = toolCall;

    logger.info(`Received tool call: apiName=${apiName}, requestId=${requestId}`);

    try {
      const args = JSON.parse(argsStr);
      const result = await this.executeToolCall(apiName, args);

      this.client?.sendToolCallResponse({
        requestId,
        result: {
          content: typeof result === 'string' ? result : JSON.stringify(result),
          success: true,
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool call failed: apiName=${apiName}, error=${errorMsg}`);

      this.client?.sendToolCallResponse({
        requestId,
        result: {
          content: '',
          error: errorMsg,
          success: false,
        },
      });
    }
  };

  private async executeToolCall(apiName: string, args: any): Promise<unknown> {
    const methodMap: Record<string, () => Promise<unknown>> = {
      editLocalFile: () => this.localFileCtr.handleEditFile(args),
      globLocalFiles: () => this.localFileCtr.handleGlobFiles(args),
      grepContent: () => this.localFileCtr.handleGrepContent(args),
      listLocalFiles: () => this.localFileCtr.listLocalFiles(args),
      readLocalFile: () => this.localFileCtr.readFile(args),
      searchLocalFiles: () => this.localFileCtr.handleLocalFilesSearch(args),
      writeLocalFile: () => this.localFileCtr.handleWriteFile(args),

      getCommandOutput: () => this.shellCommandCtr.handleGetCommandOutput(args),
      killCommand: () => this.shellCommandCtr.handleKillCommand(args),
      runCommand: () => this.shellCommandCtr.handleRunCommand(args),
    };

    const handler = methodMap[apiName];
    if (!handler) {
      throw new Error(`Unknown tool API: ${apiName}`);
    }

    return handler();
  }

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

  // ─── Device ID ───

  private loadOrCreateDeviceId() {
    const stored = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    if (stored) {
      this.deviceId = stored;
    } else {
      this.deviceId = randomUUID();
      this.app.storeManager.set('gatewayDeviceId', this.deviceId);
    }
    logger.debug(`Device ID: ${this.deviceId}`);
  }

  private getDeviceId(): string {
    return this.deviceId || 'unknown';
  }
}

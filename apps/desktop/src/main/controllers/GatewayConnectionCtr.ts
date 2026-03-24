import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';

import GatewayConnectionService from '@/services/gatewayConnectionSrv';

import { ControllerModule, IpcMethod } from './index';
import LocalFileCtr from './LocalFileCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import ShellCommandCtr from './ShellCommandCtr';

/**
 * GatewayConnectionCtr
 *
 * Thin IPC layer that delegates to GatewayConnectionService.
 */
export default class GatewayConnectionCtr extends ControllerModule {
  static override readonly groupName = 'gatewayConnection';

  // ─── Service Accessor ───

  private get service() {
    return this.app.getService(GatewayConnectionService);
  }

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
    const srv = this.service;

    srv.loadOrCreateDeviceId();

    // Wire up token provider and refresher
    srv.setTokenProvider(() => this.remoteServerConfigCtr.getAccessToken());
    srv.setTokenRefresher(() => this.remoteServerConfigCtr.refreshAccessToken());

    // Wire up tool call handler
    srv.setToolCallHandler((apiName, args) => this.executeToolCall(apiName, args));

    // Auto-connect if already logged in
    this.tryAutoConnect();
  }

  // ─── IPC Methods (Renderer → Main) ───

  @IpcMethod()
  async connect(): Promise<{ error?: string; success: boolean }> {
    return this.service.connect();
  }

  @IpcMethod()
  async disconnect(): Promise<{ success: boolean }> {
    return this.service.disconnect();
  }

  @IpcMethod()
  async getConnectionStatus(): Promise<{ status: GatewayConnectionStatus }> {
    return { status: this.service.getStatus() };
  }

  @IpcMethod()
  async getDeviceInfo(): Promise<{
    deviceId: string;
    hostname: string;
    platform: string;
  }> {
    return this.service.getDeviceInfo();
  }

  // ─── Auto Connect ───

  private async tryAutoConnect() {
    const isConfigured = await this.remoteServerConfigCtr.isRemoteServerConfigured();
    if (!isConfigured) return;

    const token = await this.remoteServerConfigCtr.getAccessToken();
    if (!token) return;

    await this.service.connect();
  }

  // ─── Tool Call Routing ───

  private async executeToolCall(apiName: string, args: any): Promise<unknown> {
    const methodMap: Record<string, () => Promise<unknown>> = {
      editLocalFile: () => this.localFileCtr.handleEditFile(args),
      globLocalFiles: () => this.localFileCtr.handleGlobFiles(args),
      grepContent: () => this.localFileCtr.handleGrepContent(args),
      listLocalFiles: () => this.localFileCtr.listLocalFiles(args),
      moveLocalFiles: () => this.localFileCtr.handleMoveFiles(args),
      readLocalFile: () => this.localFileCtr.readFile(args),
      renameLocalFile: () => this.localFileCtr.handleRenameFile(args),
      searchLocalFiles: () => this.localFileCtr.handleLocalFilesSearch(args),
      writeLocalFile: () => this.localFileCtr.handleWriteFile(args),

      getCommandOutput: () => this.shellCommandCtr.handleGetCommandOutput(args),
      killCommand: () => this.shellCommandCtr.handleKillCommand(args),
      runCommand: () => this.shellCommandCtr.handleRunCommand(args),
    };

    const handler = methodMap[apiName];
    if (!handler) {
      throw new Error(
        `Tool "${apiName}" is not available on this device. It may not be supported in the current desktop version. Please skip this tool and try alternative approaches.`,
      );
    }

    return handler();
  }
}

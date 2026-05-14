import type { AgentRunRequestMessage } from '@lobechat/device-gateway-client';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';

import GatewayConnectionService from '@/services/gatewayConnectionSrv';

import HeterogeneousAgentCtr from './HeterogeneousAgentCtr';
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

  private get heterogeneousAgentCtr() {
    return this.app.getController(HeterogeneousAgentCtr);
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

    // Wire up agent run handler
    srv.setAgentRunHandler((request) => this.executeAgentRun(request));

    // Auto-connect if already logged in
    this.tryAutoConnect();
  }

  // ─── IPC Methods (Renderer → Main) ───

  @IpcMethod()
  async connect(): Promise<{ error?: string; success: boolean }> {
    this.app.storeManager.set('gatewayEnabled', true);
    return this.service.connect();
  }

  @IpcMethod()
  async disconnect(): Promise<{ success: boolean }> {
    this.app.storeManager.set('gatewayEnabled', false);
    return this.service.disconnect();
  }

  @IpcMethod()
  async getConnectionStatus(): Promise<{ status: GatewayConnectionStatus }> {
    return { status: this.service.getStatus() };
  }

  @IpcMethod()
  async getDeviceInfo(): Promise<{
    description: string;
    deviceId: string;
    hostname: string;
    name: string;
    platform: string;
  }> {
    return this.service.getDeviceInfo();
  }

  @IpcMethod()
  async setDeviceName(params: { name: string }): Promise<{ success: boolean }> {
    this.service.setDeviceName(params.name);
    return { success: true };
  }

  @IpcMethod()
  async setDeviceDescription(params: { description: string }): Promise<{ success: boolean }> {
    this.service.setDeviceDescription(params.description);
    return { success: true };
  }

  // ─── Auto Connect ───

  private async tryAutoConnect() {
    const gatewayEnabled = this.app.storeManager.get('gatewayEnabled');
    if (!gatewayEnabled) return;

    const isConfigured = await this.remoteServerConfigCtr.isRemoteServerConfigured();
    if (!isConfigured) return;

    const token = await this.remoteServerConfigCtr.getAccessToken();
    if (!token) return;

    await this.service.connect();
  }

  // ─── Agent Run Routing ───

  private async executeAgentRun(
    request: AgentRunRequestMessage,
  ): Promise<{ reason?: string; status: 'accepted' | 'rejected' }> {
    try {
      const ctr = this.heterogeneousAgentCtr;

      // Create a session for the hetero agent.
      const { sessionId } = await ctr.startSession({
        agentType: request.agentType,
        args: [],
        command: request.agentType === 'codex' ? 'codex' : 'claude',
        cwd: request.cwd,
        // Inject LOBEHUB_JWT so the CLI authenticates against heteroIngest.
        env: { LOBEHUB_JWT: request.jwt },
        resumeSessionId: request.resumeSessionId,
      });

      // Fire-and-forget: sendPrompt runs the CLI until completion.
      ctr
        .sendPrompt({
          operationId: request.operationId,
          prompt: request.prompt,
          sessionId,
        })
        .catch((err: Error) => {
          // Errors are surfaced via heteroFinish on the server side.
          // Log locally for desktop debugging only.
          console.error('[GatewayConnectionCtr] agent run failed:', err.message);
        });

      return { status: 'accepted' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { reason, status: 'rejected' };
    }
  }

  // ─── Tool Call Routing ───

  private async executeToolCall(apiName: string, args: any): Promise<unknown> {
    const editFile = () => this.localFileCtr.handleEditFile(args);
    const globFiles = () => this.localFileCtr.handleGlobFiles(args);
    const listFiles = () => this.localFileCtr.listLocalFiles(args);
    const moveFiles = () => this.localFileCtr.handleMoveFiles(args);
    const readFile = () => this.localFileCtr.readFile(args);
    const searchFiles = () => this.localFileCtr.handleLocalFilesSearch(args);
    const writeFile = () => this.localFileCtr.handleWriteFile(args);

    const methodMap: Record<string, () => Promise<unknown>> = {
      editFile,
      globFiles,
      grepContent: () => this.localFileCtr.handleGrepContent(args),
      listFiles,
      moveFiles,
      readFile,
      searchFiles,
      writeFile,

      getCommandOutput: () => this.shellCommandCtr.handleGetCommandOutput(args),
      killCommand: () => this.shellCommandCtr.handleKillCommand(args),
      runCommand: () => this.shellCommandCtr.handleRunCommand(args),

      // Legacy aliases — keep these so older Gateway versions sending the long
      // names continue to route correctly. `renameLocalFile` is also kept even
      // though the new surface drops rename (it's now handled by `moveFiles`).
      editLocalFile: editFile,
      globLocalFiles: globFiles,
      listLocalFiles: listFiles,
      moveLocalFiles: moveFiles,
      readLocalFile: readFile,
      renameLocalFile: () => this.localFileCtr.handleRenameFile(args),
      searchLocalFiles: searchFiles,
      writeLocalFile: writeFile,
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

import type {
  ImessageBridgeConfig,
  ImessageBridgeSaveResult,
  ImessageBridgeStatus,
} from '@lobechat/electron-client-ipc';

import ImessageBridgeService from '@/services/imessageBridgeSrv';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:ImessageBridgeCtr');

export default class ImessageBridgeCtr extends ControllerModule {
  static override readonly groupName = 'imessageBridge';

  private get service() {
    return this.app.getService(ImessageBridgeService);
  }

  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  afterAppReady() {
    this.service.setRemoteServerProvider({
      getAccessToken: () => this.remoteServerConfigCtr.getAccessToken(),
      getServerUrl: async () => (await this.remoteServerConfigCtr.getRemoteServerUrl()) ?? null,
    });

    this.service.start().catch((error) => {
      // The user can fix BlueBubbles or remote-server settings from the UI and start again.
      logger.warn('Failed to auto-start iMessage bridge:', error);
    });
  }

  @IpcMethod()
  async getStatus(): Promise<ImessageBridgeStatus> {
    return this.service.getStatus();
  }

  @IpcMethod()
  async upsertConfig(config: ImessageBridgeConfig): Promise<ImessageBridgeSaveResult> {
    const saved = await this.service.upsertConfig(config);
    return { config: saved, success: true };
  }

  @IpcMethod()
  async removeConfig(params: { applicationId: string }): Promise<{ success: boolean }> {
    return this.service.removeConfig(params.applicationId);
  }

  @IpcMethod()
  async start(): Promise<ImessageBridgeStatus> {
    return this.service.start();
  }

  @IpcMethod()
  async stop(): Promise<{ success: boolean }> {
    return this.service.stop();
  }

  @IpcMethod()
  async testConfig(config: ImessageBridgeConfig): Promise<{ success: boolean }> {
    return this.service.testConfig(config);
  }
}

import { ControllerModule, IpcMethod } from './index';

export default class RendererOtaCtr extends ControllerModule {
  static override readonly groupName = 'rendererOta';

  @IpcMethod()
  async bootPing(stage?: 'loaded' | 'mounted') {
    this.app.rendererUpdateManager.handleBootPing(stage);
  }

  @IpcMethod()
  async applyNow(): Promise<boolean> {
    return this.app.rendererUpdateManager.applyStagedNow();
  }

  @IpcMethod()
  async getStatus() {
    return this.app.rendererUpdateManager.getStatus();
  }

  @IpcMethod()
  async checkNow() {
    await this.app.rendererUpdateManager.checkForUpdates();
    return this.app.rendererUpdateManager.getStatus();
  }
}

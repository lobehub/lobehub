import { shellInfo } from '@/const/shell';

import { ControllerModule, IpcMethod } from './index';

export default class RendererOtaCtr extends ControllerModule {
  static override readonly groupName = 'rendererOta';

  private coreMarkedHealthy = false;

  @IpcMethod()
  async bootPing(stage?: 'loaded' | 'mounted') {
    this.app.coreUpdateManager.handleBootPing(stage);
    if (stage === 'loaded' || this.coreMarkedHealthy) return;
    this.coreMarkedHealthy = true;
    shellInfo?.markHealthy();
  }

  @IpcMethod()
  async applyNow(): Promise<boolean> {
    return this.app.coreUpdateManager.applyStagedNow();
  }

  @IpcMethod()
  async getStatus() {
    return this.app.coreUpdateManager.getStatus();
  }

  @IpcMethod()
  async checkNow() {
    await this.app.coreUpdateManager.checkForUpdates();
    return this.app.coreUpdateManager.getStatus();
  }
}

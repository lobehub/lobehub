import { shellInfo } from '@/const/shell';
import { getIpcContext } from '@/utils/ipc';

import { ControllerModule, IpcMethod } from './index';

export default class RendererOtaCtr extends ControllerModule {
  static override readonly groupName = 'rendererOta';

  private coreMarkedHealthy = false;

  @IpcMethod()
  async bootPing(stage?: 'loaded' | 'mounted') {
    this.app.coreUpdateManager.handleBootPing(stage, getIpcContext()?.sender.id);
    if (stage === 'loaded' || this.coreMarkedHealthy) return;
    this.coreMarkedHealthy = true;
    shellInfo?.markHealthy();
  }

  @IpcMethod()
  async applyNow(): Promise<boolean> {
    return this.app.coreUpdateManager.applyStagedNow();
  }

  @IpcMethod()
  async resolveUnloadConfirmation(proceed: boolean) {
    const sender = getIpcContext()?.sender;
    if (!sender) return;
    const browser = [...this.app.browserManager.browsers.values()].find(
      (item) => item.webContents?.id === sender.id,
    );
    browser?.resolveUnloadConfirmation(proceed);
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

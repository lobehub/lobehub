import { app } from 'electron';

import { ControllerModule, IpcMethod } from './index';

export default class DevtoolsCtr extends ControllerModule {
  static override readonly groupName = 'devtools';

  @IpcMethod()
  async openDevtools() {
    const devtoolsBrowser = this.app.browserManager.retrieveByIdentifier('devtools');
    devtoolsBrowser.show();
  }

  @IpcMethod()
  async getAppCpuUsage() {
    const metrics = app.getAppMetrics();
    const percent = metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0);
    return { percent };
  }
}

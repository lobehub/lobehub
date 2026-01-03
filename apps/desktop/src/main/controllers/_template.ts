import { ControllerModule, IpcMethod } from './index';

export default class DevtoolsCtr extends ControllerModule {
  @IpcMethod()
  async openDevtools() {
    const devtoolsBrowser = this.app.browserManager.retrieveByIdentifier('devtools');
    devtoolsBrowser.show();
  }
}

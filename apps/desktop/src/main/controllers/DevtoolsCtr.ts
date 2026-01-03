import { ControllerModule, IpcMethod } from './index';

export default class DevtoolsCtr extends ControllerModule {
  static override readonly groupName = 'devtools';

  @IpcMethod()
  async openDevtools() {
    const devtoolsBrowser = this.app.browserManager.retrieveByIdentifier('devtools');
    devtoolsBrowser.show();
  }
}

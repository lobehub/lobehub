import type {
  BrowserControlClickParams,
  BrowserControlClickResult,
  BrowserControlFillParams,
  BrowserControlParams,
  BrowserControlPressParams,
  BrowserControlReadPageResult,
  BrowserControlResult,
  BrowserControlScreenshotResult,
  BrowserControlScrollParams,
  BrowserControlSnapshotResult,
  BrowserControlWaitForParams,
  BrowserGatewayToolResultParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class ElectronBrowserControlService {
  private get ipc() {
    return ensureElectronIpc();
  }

  reportGatewayToolResult(params: BrowserGatewayToolResultParams): Promise<void> {
    return this.ipc.browserControl.reportGatewayToolResult(params);
  }

  click(params: BrowserControlClickParams): Promise<BrowserControlClickResult> {
    return this.ipc.browserControl.click(params);
  }

  fill(params: BrowserControlFillParams): Promise<BrowserControlResult> {
    return this.ipc.browserControl.fill(params);
  }

  press(params: BrowserControlPressParams): Promise<BrowserControlResult> {
    return this.ipc.browserControl.press(params);
  }

  readPage(params: BrowserControlParams): Promise<BrowserControlReadPageResult> {
    return this.ipc.browserControl.readPage(params);
  }

  screenshot(params: BrowserControlParams): Promise<BrowserControlScreenshotResult> {
    return this.ipc.browserControl.screenshot(params);
  }

  scroll(params: BrowserControlScrollParams): Promise<BrowserControlResult> {
    return this.ipc.browserControl.scroll(params);
  }

  snapshot(params: BrowserControlParams): Promise<BrowserControlSnapshotResult> {
    return this.ipc.browserControl.snapshot(params);
  }

  waitFor(params: BrowserControlWaitForParams): Promise<BrowserControlResult> {
    return this.ipc.browserControl.waitFor(params);
  }
}

export const electronBrowserControlService = new ElectronBrowserControlService();

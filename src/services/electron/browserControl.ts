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

import { browserWebviewRegistry } from './browserWebviewRegistry';

class ElectronBrowserControlService {
  private get ipc() {
    return ensureElectronIpc();
  }

  reportGatewayToolResult(params: BrowserGatewayToolResultParams): Promise<void> {
    return this.ipc.browserControl.reportGatewayToolResult(params);
  }

  click(params: BrowserControlClickParams): Promise<BrowserControlClickResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.click(params);
  }

  fill(params: BrowserControlFillParams): Promise<BrowserControlResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.fill(params);
  }

  press(params: BrowserControlPressParams): Promise<BrowserControlResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.press(params);
  }

  readPage(params: BrowserControlParams): Promise<BrowserControlReadPageResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.readPage(params);
  }

  screenshot(params: BrowserControlParams): Promise<BrowserControlScreenshotResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.screenshot(params);
  }

  scroll(params: BrowserControlScrollParams): Promise<BrowserControlResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.scroll(params);
  }

  snapshot(params: BrowserControlParams): Promise<BrowserControlSnapshotResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.snapshot(params);
  }

  waitFor(params: BrowserControlWaitForParams): Promise<BrowserControlResult> {
    browserWebviewRegistry.touch(params.sessionId);
    return this.ipc.browserControl.waitFor(params);
  }
}

export const electronBrowserControlService = new ElectronBrowserControlService();

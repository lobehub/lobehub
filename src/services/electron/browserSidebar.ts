import type {
  BrowserSidebarCaptureResult,
  BrowserSidebarImportResult,
  BrowserSidebarNavigateParams,
  BrowserSidebarOverlayLabelsParams,
  BrowserSidebarPickElementParams,
  BrowserSidebarPickElementResult,
  BrowserSidebarResult,
  BrowserSidebarSessionParams,
  BrowserSidebarState,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

import { browserWebviewRegistry } from './browserWebviewRegistry';

class ElectronBrowserSidebarService {
  private get ipc() {
    return ensureElectronIpc();
  }

  cancelElementPick(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.cancelElementPick(params);
  }

  captureScreenshot(params: BrowserSidebarSessionParams): Promise<BrowserSidebarCaptureResult> {
    return this.ipc.browserSidebar.captureScreenshot(params);
  }

  getState(params: BrowserSidebarSessionParams): Promise<BrowserSidebarState> {
    return this.ipc.browserSidebar.getState(params);
  }

  goBack(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.goBack(params);
  }

  goForward(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.goForward(params);
  }

  importChromeLoginData(): Promise<BrowserSidebarImportResult> {
    return this.ipc.browserSidebar.importChromeLoginData();
  }

  async navigate(params: BrowserSidebarNavigateParams): Promise<BrowserSidebarResult> {
    await browserWebviewRegistry.ensure(params.sessionId);
    return this.ipc.browserSidebar.navigate(params);
  }

  openExternal(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.openExternal(params);
  }

  pickElement(params: BrowserSidebarPickElementParams): Promise<BrowserSidebarPickElementResult> {
    return this.ipc.browserSidebar.pickElement(params);
  }

  reload(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.reload(params);
  }

  setOverlayLabels(params: BrowserSidebarOverlayLabelsParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.setOverlayLabels(params);
  }

  stop(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.stop(params);
  }
}

export const electronBrowserSidebarService = new ElectronBrowserSidebarService();

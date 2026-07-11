import type {
  BrowserSidebarNavigateParams,
  BrowserSidebarResult,
  BrowserSidebarSessionParams,
  BrowserSidebarState,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class ElectronBrowserSidebarService {
  private get ipc() {
    return ensureElectronIpc();
  }

  captureScreenshotToClipboard(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.captureScreenshotToClipboard(params);
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

  navigate(params: BrowserSidebarNavigateParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.navigate(params);
  }

  openExternal(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.openExternal(params);
  }

  reload(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.reload(params);
  }

  stop(params: BrowserSidebarSessionParams): Promise<BrowserSidebarResult> {
    return this.ipc.browserSidebar.stop(params);
  }
}

export const electronBrowserSidebarService = new ElectronBrowserSidebarService();

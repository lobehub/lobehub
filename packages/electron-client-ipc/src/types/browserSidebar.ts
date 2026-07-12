export interface BrowserSidebarSessionParams {
  sessionId: string;
}

export interface BrowserSidebarAttachParams extends BrowserSidebarSessionParams {
  webContentsId: number;
}

export interface BrowserSidebarNavigateParams extends BrowserSidebarSessionParams {
  url: string;
}

export interface BrowserSidebarState {
  attached: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
  isLoading: boolean;
  sessionId: string;
  title: string;
  url: string;
}

export interface BrowserSidebarResult {
  error?: string;
  success: boolean;
}

export interface BrowserSidebarImportResult extends BrowserSidebarResult {
  importedCount: number;
}

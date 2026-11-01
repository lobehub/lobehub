export interface BrowserSidebarSessionParams {
  sessionId: string;
}

export interface BrowserSidebarNavigateParams extends BrowserSidebarSessionParams {
  url: string;
}

export interface BrowserSidebarRegisterWebviewParams extends BrowserSidebarSessionParams {
  /** Electron guest WebContents id returned by `<webview>.getWebContentsId()`. */
  webContentsId: number;
}

/** Panel rect in main-window coordinates (CSS px, as `getBoundingClientRect` reports it). */
export interface BrowserSidebarRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** The agent overlay is drawn inside the page, so its copy has to come from the renderer. */
export interface BrowserSidebarOverlayLabelsParams {
  controlling: string;
  cursor: string;
}

export interface BrowserSidebarState {
  attached: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
  faviconUrl?: string;
  isLoading: boolean;
  sessionId: string;
  title: string;
  url: string;
}

export interface BrowserSidebarResult {
  error?: string;
  success: boolean;
}

export interface BrowserSidebarCaptureResult extends BrowserSidebarResult {
  /** PNG data URL of the visible page, ready to become an input attachment. */
  dataUrl?: string;
  title?: string;
}

export interface BrowserSidebarPickElementParams extends BrowserSidebarSessionParams {
  /** Localized in-page hint — the picker UI is drawn inside the guest page. */
  hint: string;
}

export interface BrowserSidebarPickedElement {
  /** Trimmed `outerHTML`, capped by the picker script. */
  html: string;
  pageTitle: string;
  /** Viewport rect at pick time (CSS px). */
  rect?: BrowserSidebarRect;
  /** Short structural path, e.g. `#main > div.card:nth-of-type(2)`. */
  selector: string;
  tag: string;
  text: string;
  /** Cropped screenshot of the picked element (JPEG data URL), when capturable. */
  thumbnailUrl?: string;
  url: string;
}

export interface BrowserSidebarPickElementResult extends BrowserSidebarResult {
  /** True when the pick ended without a choice (Escape, restart, navigation). */
  cancelled?: boolean;
  element?: BrowserSidebarPickedElement;
}

export interface BrowserSidebarImportResult extends BrowserSidebarResult {
  importedCount: number;
}

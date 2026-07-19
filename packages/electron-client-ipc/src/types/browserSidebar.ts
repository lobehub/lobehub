export interface BrowserSidebarSessionParams {
  sessionId: string;
}

export interface BrowserSidebarNavigateParams extends BrowserSidebarSessionParams {
  url: string;
}

/** Panel rect in main-window coordinates (CSS px, as `getBoundingClientRect` reports it). */
export interface BrowserSidebarRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface BrowserSidebarViewportParams extends BrowserSidebarSessionParams {
  /**
   * Where to show the page. Omit it (or send a zero-sized rect) when the panel is
   * hidden — the page is then parked off-screen: still live, never destroyed.
   */
  rect?: BrowserSidebarRect;
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

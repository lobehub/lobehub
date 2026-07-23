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

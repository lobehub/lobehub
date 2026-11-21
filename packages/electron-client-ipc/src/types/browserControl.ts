export interface BrowserControlParams {
  sessionId: string;
}

export interface BrowserControlResult {
  error?: string;
  success: boolean;
}

export interface BrowserControlPageInfo {
  title?: string;
  url?: string;
}

export interface BrowserControlSnapshotResult extends BrowserControlResult, BrowserControlPageInfo {
  snapshot?: string;
}

export interface BrowserControlClickParams extends BrowserControlParams {
  /** Element ref from the latest snapshot (e.g. `e12`). Preferred over coordinates. */
  ref?: string;
  /** Viewport coordinates fallback when no ref is available. */
  x?: number;
  y?: number;
}

export interface BrowserControlClickResult extends BrowserControlResult, BrowserControlPageInfo {}

export interface BrowserControlFillParams extends BrowserControlParams {
  ref: string;
  /** Press Enter after filling (submit forms / search boxes). */
  submit?: boolean;
  text: string;
}

export interface BrowserControlPressParams extends BrowserControlParams {
  /** A key or `+`-joined combination, e.g. `Enter`, `ArrowDown`, `Control+a`, `Shift+Tab`. */
  key: string;
}

/** Size of the panel the session's page is shown in, in CSS pixels. */
export interface BrowserControlPanelSizeParams extends BrowserControlParams {
  height: number;
  width: number;
}

export interface BrowserControlSetViewportParams extends BrowserControlParams {
  /** CSS pixels; omit both width and height to go back to the panel's own size. */
  height?: number;
  width?: number;
}

export interface BrowserControlSetViewportResult extends BrowserControlResult {
  /** How far the panel shrinks the viewport to fit it (1 = shown at full size). */
  scale?: number;
}

export interface BrowserControlScrollParams extends BrowserControlParams {
  dx?: number;
  dy: number;
}

export interface BrowserControlScreenshotResult extends BrowserControlResult {
  /** JPEG data URL, downscaled to a model-friendly width. */
  dataUrl?: string;
  height?: number;
  width?: number;
}

export interface BrowserControlReadPageResult extends BrowserControlResult, BrowserControlPageInfo {
  content?: string;
  selectedText?: string;
}

export interface BrowserControlUploadFileParams extends BrowserControlParams {
  /** Absolute paths of files on this device; a leading `~` is the home folder. */
  paths: string[];
  /**
   * Snapshot ref of a file input, or of the button / drop zone that opens the
   * page's file chooser. Without a ref or selector, the page's only file input.
   */
  ref?: string;
  /** CSS selector of the file input, instead of a ref. */
  selector?: string;
}

export interface BrowserUploadedFile {
  name: string;
  size: number;
}

export interface BrowserControlUploadFileResult
  extends BrowserControlResult, BrowserControlPageInfo {
  /** `accept` of the input that took the files. */
  accept?: string;
  /** The files the page's input holds afterwards, read back from the page. */
  files?: BrowserUploadedFile[];
  /**
   * No automated path reaches this page's file picker. The user has to choose
   * the file themselves; retrying the upload will not help.
   */
  manualSelectionRequired?: boolean;
  /** `input`: set on the file input itself; `fileChooser`: through the chooser a click opened. */
  via?: 'fileChooser' | 'input';
}

export interface BrowserControlWaitForParams extends BrowserControlParams {
  /** Milliseconds to wait (capped). */
  ms?: number;
  /** Resolve early once this text appears in the page. */
  text?: string;
}

export interface BrowserToolCallResult {
  content?: string;
  error?: { body?: unknown; message: string; type: string };
  state?: unknown;
  success: boolean;
}

/**
 * A browser tool call proxied from a cloud agent run back to this device.
 * The renderer runs the client `browserExecutor` and reports the result via
 * `reportGatewayToolResult`, keyed by `requestId`.
 */
export interface BrowserGatewayToolCallPayload {
  agentId: string;
  apiName: string;
  args: Record<string, unknown>;
  requestId: string;
  /** Topic the run belongs to — keys the browser session (`topic:<topicId>`). */
  topicId: string;
}

export interface BrowserGatewayToolResultParams {
  requestId: string;
  result: BrowserToolCallResult;
}

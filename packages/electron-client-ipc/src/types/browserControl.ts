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
  /** KeyboardEvent.key value, e.g. `Enter`, `Tab`, `Escape`, `ArrowDown`. */
  key: string;
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
}

export interface BrowserGatewayToolResultParams {
  requestId: string;
  result: BrowserToolCallResult;
}

export interface BrowserSidebarAgentStatePayload {
  active: boolean;
  sessionId: string;
}

export interface BrowserSidebarAgentCursorPayload {
  click?: boolean;
  sessionId: string;
  x: number;
  y: number;
}

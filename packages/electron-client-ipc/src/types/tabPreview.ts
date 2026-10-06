export interface TabPreviewRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface TabPreviewCaptureParams {
  /** Content-area bounds in CSS pixels, as reported by `getBoundingClientRect()`. */
  rect: TabPreviewRect;
  tabId: string;
}

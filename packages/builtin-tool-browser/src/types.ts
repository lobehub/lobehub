export const BrowserIdentifier = 'lobe-browser';

export const BrowserApiName = {
  click: 'click',
  fill: 'fill',
  navigate: 'navigate',
  press: 'press',
  readPage: 'readPage',
  screenshot: 'screenshot',
  scroll: 'scroll',
  setViewport: 'setViewport',
  snapshot: 'snapshot',
} as const;

export type BrowserApiNameType = (typeof BrowserApiName)[keyof typeof BrowserApiName];

export interface BrowserPageState {
  title?: string;
  url?: string;
}

export interface BrowserNavigateState extends BrowserPageState {}

export interface BrowserSnapshotState extends BrowserPageState {
  snapshot: string;
}

export interface BrowserClickState extends BrowserPageState {}

export interface BrowserScreenshotState {
  /**
   * Inline capture, produced by the client executor. The server-proxied path
   * stores the image instead and sets {@link BrowserScreenshotState.url}, so a
   * consumer must accept either.
   */
  dataUrl?: string;
  height?: number;
  /**
   * The shared tool-image contract the context engine sends to the model:
   * stored artifacts with a `fileId`, or the local executor's inline capture.
   */
  images?: { fileId?: string; mediaType: string; url: string }[];
  /** Accessible URL of the stored capture. */
  url?: string;
  width?: number;
}

export interface BrowserReadPageState extends BrowserPageState {
  content: string;
}

export interface BrowserNavigateArgs {
  url: string;
}

export interface BrowserClickArgs {
  ref?: string;
  x?: number;
  y?: number;
}

export interface BrowserFillArgs {
  /** Code editors only: replace this exact passage instead of the whole text. */
  oldText?: string;
  ref: string;
  submit?: boolean;
  text: string;
}

export interface BrowserPressArgs {
  key: string;
}

export interface BrowserScrollArgs {
  dx?: number;
  dy: number;
}

export interface BrowserSetViewportArgs {
  height?: number;
  width?: number;
}

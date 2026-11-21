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
  uploadFile: 'uploadFile',
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
  /** Stored artifacts, `{ fileId, mediaType, url }` — the shared tool-image contract. */
  images?: { fileId: string; mediaType: string; url: string }[];
  /** Accessible URL of the stored capture. */
  url?: string;
  width?: number;
}

export interface BrowserReadPageState extends BrowserPageState {
  content: string;
}

export interface BrowserUploadedFile {
  name: string;
  size: number;
}

export interface BrowserUploadFileState extends BrowserPageState {
  /** `accept` of the input that took the files. */
  accept?: string;
  /** What the page's input holds afterwards, read back from the page. */
  files?: BrowserUploadedFile[];
  /**
   * Set on the failure result when no automated path reaches the page's file
   * picker: the user has to choose the file; retrying will not help.
   */
  manualSelectionRequired?: boolean;
  /** The paths the call asked for. */
  paths?: string[];
  /** Why the upload has to be done by hand. */
  reason?: string;
  via?: 'fileChooser' | 'input';
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

export interface BrowserUploadFileArgs {
  paths: string[];
  ref?: string;
  selector?: string;
}

export const BrowserIdentifier = 'lobe-browser';

export const BrowserApiName = {
  click: 'click',
  fill: 'fill',
  navigate: 'navigate',
  press: 'press',
  readPage: 'readPage',
  screenshot: 'screenshot',
  scroll: 'scroll',
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
  dataUrl: string;
  height?: number;
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

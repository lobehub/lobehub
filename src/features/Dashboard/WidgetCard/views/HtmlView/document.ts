/**
 * The sandboxed document a `view.html` card runs in, and the messages it
 * exchanges with the host. The frame has an opaque origin (`sandbox` without
 * `allow-same-origin`), so it cannot reach the app's cookies, storage or API;
 * the CSP below also blocks every network request, so a card can only draw
 * the output it is handed.
 */

export const WIDGET_HTML_HOST_SOURCE = 'lobe-widget-host';
export const WIDGET_HTML_FRAME_SOURCE = 'lobe-widget-frame';

export const WIDGET_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export type WidgetHtmlFrameMessage =
  | { source: typeof WIDGET_HTML_FRAME_SOURCE; type: 'ready' }
  | { source: typeof WIDGET_HTML_FRAME_SOURCE; type: 'open'; url: string };

/**
 * Runs before the author's markup. `window.lobeWidget` exposes the latest
 * output (`data` is `output.data` for a data output, else the whole output,
 * matching layout bindings) and calls `onUpdate` listeners on every refresh.
 */
const BRIDGE = `(() => {
  const HOST = '${WIDGET_HTML_HOST_SOURCE}';
  const FRAME = '${WIDGET_HTML_FRAME_SOURCE}';
  const state = { data: null, output: null, theme: { appearance: 'light' } };
  const listeners = new Set();
  const notify = (listener) => {
    try { listener(state); } catch (error) { console.error(error); }
  };
  window.lobeWidget = {
    get data() { return state.data; },
    get output() { return state.output; },
    get theme() { return state.theme; },
    onUpdate(listener) {
      listeners.add(listener);
      if (state.output) notify(listener);
      return () => listeners.delete(listener);
    },
    open(url) { parent.postMessage({ source: FRAME, type: 'open', url: String(url) }, '*'); },
  };
  addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.source !== HOST || message.type !== 'update') return;
    state.output = message.output;
    state.data = message.output && message.output.type === 'data' ? message.output.data : message.output;
    state.theme = message.theme;
    document.documentElement.dataset.theme = message.theme.appearance;
    listeners.forEach(notify);
  });
  parent.postMessage({ source: FRAME, type: 'ready' }, '*');
})();`;

const BASE_STYLE =
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}';

/**
 * Wrap an author's document. The CSP meta comes first so it applies before
 * any author markup is parsed; a later CSP in the author's markup can only
 * tighten it. A full document (`<!doctype html><html>…`) and a bare fragment
 * both work: the parser folds the author's `<html>` / `<head>` into this one.
 */
export const createWidgetHtmlDocument = (html: string) =>
  [
    `<meta http-equiv="Content-Security-Policy" content="${WIDGET_HTML_CSP}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${BASE_STYLE}</style>`,
    `<script>${BRIDGE}</script>`,
    html,
  ].join('\n');

/** Only web links leave the card, in a new tab. */
export const isOpenableWidgetUrl = (url: unknown): url is string => {
  if (typeof url !== 'string') return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

export const isWidgetHtmlFrameMessage = (data: unknown): data is WidgetHtmlFrameMessage =>
  !!data &&
  typeof data === 'object' &&
  (data as { source?: unknown }).source === WIDGET_HTML_FRAME_SOURCE;

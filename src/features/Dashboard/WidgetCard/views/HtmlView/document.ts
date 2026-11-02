/**
 * The sandboxed documents a `view.html` card runs in, and the messages they
 * exchange with the host.
 *
 * Two nested frames, both `sandbox="allow-scripts"` (opaque origin: no
 * cookies, storage or app API):
 *
 * - the **wrapper** (`WIDGET_HTML_WRAPPER_DOCUMENT`) is ours and fixed. Its
 *   CSP `frame-src 'none'` makes the browser refuse every navigation of its
 *   child frame, whoever starts it — `default-src` alone does not cover
 *   navigation, so a frame could otherwise leave with the data in its URL.
 *   It relays messages both ways, and if the child ever loads a second
 *   document it removes it and stops relaying.
 * - the **content** frame runs the author's HTML (`createWidgetHtmlDocument`),
 *   whose CSP blocks every fetch, so a card can only draw what it is handed.
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

/**
 * A srcdoc frame inherits its parent's CSP on top of its own, so the wrapper
 * allows what the content needs (data: images and fonts) and adds only the
 * navigation rule.
 */
export const WIDGET_HTML_WRAPPER_CSP = `${WIDGET_HTML_CSP}; frame-src 'none'`;

export type WidgetHtmlFrameMessage =
  /** The wrapper is listening; send it the content document. */
  | { source: typeof WIDGET_HTML_FRAME_SOURCE; type: 'wrapper-ready' }
  /** The content document's bridge is listening; send it the output. */
  | { source: typeof WIDGET_HTML_FRAME_SOURCE; type: 'ready' }
  | { source: typeof WIDGET_HTML_FRAME_SOURCE; type: 'open'; url: string }
  /** The content frame tried to leave its document; the wrapper dropped it. */
  | { source: typeof WIDGET_HTML_FRAME_SOURCE; type: 'navigated' };

/**
 * Runs before the author's markup. `window.widgetData` exposes the latest
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
  window.widgetData = {
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

const WRAPPER = `(() => {
  const HOST = '${WIDGET_HTML_HOST_SOURCE}';
  const FRAME = '${WIDGET_HTML_FRAME_SOURCE}';
  let content = null;
  let escaped = false;
  const drop = () => {
    escaped = true;
    content?.remove();
    content = null;
    parent.postMessage({ source: FRAME, type: 'navigated' }, '*');
  };
  addEventListener('message', (event) => {
    const message = event.data;
    if (escaped || !message) return;
    if (event.source === parent && message.source === HOST) {
      if (message.type === 'document') {
        content?.remove();
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('title', 'widget');
        let loads = 0;
        // Only the srcdoc ever loads; a second load means the frame left it.
        frame.addEventListener('load', () => {
          loads += 1;
          if (loads > 1 && frame === content) drop();
        });
        frame.srcdoc = message.html;
        content = frame;
        document.body.append(frame);
        return;
      }
      content?.contentWindow?.postMessage(message, '*');
      return;
    }
    if (content && event.source === content.contentWindow && message.source === FRAME) {
      parent.postMessage(message, '*');
    }
  });
  parent.postMessage({ source: FRAME, type: 'wrapper-ready' }, '*');
})();`;

const WRAPPER_STYLE =
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}' +
  'iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}';

/** The fixed outer document every widget HTML frame loads first. */
export const WIDGET_HTML_WRAPPER_DOCUMENT = [
  `<meta http-equiv="Content-Security-Policy" content="${WIDGET_HTML_WRAPPER_CSP}">`,
  '<meta charset="utf-8">',
  `<style>${WRAPPER_STYLE}</style>`,
  '<body>',
  `<script>${WRAPPER}</script>`,
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

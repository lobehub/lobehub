import { APP_IFRAME_ALLOW, injectCsp } from './utils';

/**
 * The documents an MCP App view runs in. Two nested frames, both sandboxed
 * without `allow-same-origin` (opaque origin: no cookies, storage or app API):
 *
 * - the **wrapper** is ours. A document's CSP restricts what it fetches and
 *   which child frames it may navigate (`frame-src`), not navigations of its
 *   own frame, so a view loaded directly could leave with data in its URL
 *   (`location.href = …`). The wrapper's `frame-src` holds the view frame to
 *   the frame domains the resource declared: the boundary is those domains,
 *   which the view may embed and message anyway. It relays the view's
 *   postMessage traffic both ways unchanged. When the view frame loads a
 *   second document it removes it and stops relaying, so a view that left its
 *   document doesn't linger in the chat; a page the view frame reaches first
 *   (before its own document finished loading) stays, within those domains.
 * - the **view** frame runs the app's HTML behind the same CSP (`injectCsp`).
 *
 * A srcdoc frame inherits its parent's CSP on top of its own, so the wrapper
 * carries exactly the view's policy: anything stricter would take away what
 * the resource declared.
 */

export const MCP_APP_FRAME_SOURCE = 'lobe-mcp-app-frame';

/** The view frame tried to leave its document; the wrapper dropped it. */
export interface McpAppFrameNavigatedNotice {
  source: typeof MCP_APP_FRAME_SOURCE;
  type: 'navigated';
}

export const VIEW_FRAME_SANDBOX = 'allow-scripts allow-forms';

// Inside an inline script: `<` can't open `</script>` or `<!--` once escaped
const toScriptString = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');

const WRAPPER_STYLE =
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}' +
  'iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}';

const wrapperScript = (viewDocument: string) => `(() => {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', ${toScriptString(VIEW_FRAME_SANDBOX)});
  frame.setAttribute('allow', ${toScriptString(APP_IFRAME_ALLOW)});
  frame.setAttribute('title', 'MCP App');
  let loads = 0;
  let dropped = false;
  // Only the srcdoc ever loads; a second load means the frame left it.
  frame.addEventListener('load', () => {
    loads += 1;
    if (loads < 2 || dropped) return;
    dropped = true;
    frame.remove();
    parent.postMessage({ source: ${toScriptString(MCP_APP_FRAME_SOURCE)}, type: 'navigated' }, '*');
  });
  addEventListener('message', (event) => {
    if (dropped) return;
    if (event.source === parent) frame.contentWindow?.postMessage(event.data, '*');
    else if (event.source === frame.contentWindow) parent.postMessage(event.data, '*');
  });
  frame.srcdoc = ${toScriptString(viewDocument)};
  document.body.append(frame);
})();`;

/**
 * The document the host iframe loads: the wrapper, with the app's HTML (behind
 * `csp`) inside it.
 */
export const buildAppFrameDocument = (html: string, csp: string): string =>
  injectCsp(
    [
      '<meta charset="utf-8">',
      `<style>${WRAPPER_STYLE}</style>`,
      '<body>',
      `<script>${wrapperScript(injectCsp(html, csp))}</script>`,
    ].join('\n'),
    csp,
  );

export const isAppFrameNavigatedNotice = (data: unknown): data is McpAppFrameNavigatedNotice =>
  !!data &&
  typeof data === 'object' &&
  (data as { source?: unknown }).source === MCP_APP_FRAME_SOURCE &&
  (data as { type?: unknown }).type === 'navigated';

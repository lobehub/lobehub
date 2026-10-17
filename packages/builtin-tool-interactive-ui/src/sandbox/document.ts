import type { SandboxMode } from './bridge';
import { FRAME_BOOTSTRAP, WORKER_BOOTSTRAP } from './runtime';
import { sanitizeSandboxHtml } from './sanitize';

export interface SandboxSource {
  css?: string;
  html: string;
  js?: string;
}

const serializeScriptValue = (value: string): string =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

/**
 * Create an inert preview or a Worker-backed interactive document. Mount only
 * with iframe sandbox="allow-scripts" (never allow-same-origin), and a fresh
 * random token per mount. Generated code never runs in the iframe's Window.
 * This function needs a browser DOM for DOMPurify; call after client mount.
 */
export const buildSandboxDocument = (
  source: SandboxSource,
  nonce: string,
  mode: SandboxMode,
): string => {
  if (!/^[\w-]{16,128}$/.test(nonce)) throw new Error('Invalid sandbox nonce');
  if (mode !== 'preview' && mode !== 'complete') throw new Error('Invalid sandbox mode');
  if (
    typeof source.html !== 'string' ||
    source.html.length > 100000 ||
    (source.css !== undefined && (typeof source.css !== 'string' || source.css.length > 50000)) ||
    (source.js !== undefined && (typeof source.js !== 'string' || source.js.length > 100000))
  )
    throw new Error('Sandbox source exceeds the supported size');

  const html = sanitizeSandboxHtml(source.html);
  // HTML raw-text parsing precedes CSS parsing. Escape every '<' in CSS so even
  // a literal closing style tag cannot create markup outside the stylesheet.
  const css = (source.css || '').replaceAll('<', '\\3c ');
  const policy = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    mode === 'complete' ? `script-src 'nonce-${nonce}' blob:` : "script-src 'none'",
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    mode === 'complete' ? 'worker-src blob:' : "worker-src 'none'",
  ].join('; ');

  const script =
    mode === 'complete'
      ? `<script nonce="${nonce}">${FRAME_BOOTSTRAP.replaceAll(
          /__LOBE_(WORKER_BOOTSTRAP|GENERATED_SOURCE|FRAME_TOKEN)__/g,
          (_placeholder, key: string) =>
            serializeScriptValue(
              key === 'FRAME_TOKEN'
                ? nonce
                : key === 'WORKER_BOOTSTRAP'
                  ? WORKER_BOOTSTRAP
                  : source.js || '',
            ),
        )}</script>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light dark}body{margin:0;padding:16px;font:14px system-ui,sans-serif}*{box-sizing:border-box}input,button,select,textarea{font:inherit}\n${css}</style></head><body><main id="__lobe_ui_root">${html}</main><p id="__lobe_ui_status" role="status" hidden></p>${script}</body></html>`;
};

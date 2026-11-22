import type { Plugin } from 'vite';

// Private internals of @stylexjs/unplugin (lib/consts.js and lib/vite.js), pinned
// at 0.19.1. The package exports no subpath for them, so they are mirrored here and
// stylexDevCss.test.ts reads the installed unplugin to fail on drift. Re-check the
// shim below whenever the unplugin version changes.
export const stylexDevCssPath = '/virtual:stylex.css';
export const stylexDevRuntimeId = 'virtual:stylex:runtime';
const stylexDevStyleId = '__stylex_virtual__';
const stylexCssUpdateEvent = 'stylex:css-update';

// Kept dependency-free: the Next dev HTML rewriter (src/libs/spaHtml) imports it.
export const stylexProxiedDevCssModuleId = 'virtual:lobe-stylex-dev-css';

/** Leading comment of the dev CSS response that carries the rule-store version it reflects. */
export const stylexDevCssVersionMarker = 'lobe-stylex-version:';

/**
 * Upper bound a module waits for its CSS, so a broken dev CSS endpoint never
 * blocks the app. Each response re-collects every rule, and while a cold start
 * is still transforming modules one request was measured at over 5 seconds.
 */
const STYLE_WAIT_TIMEOUT = 15_000;

// One runtime for both the Vite-served SPA and the proxied SPA, whose document
// origin is Next: a root-relative fetch of /virtual:stylex.css never reaches Vite,
// so the CSS URL is built from import.meta.url, which stays on the Vite origin.
//
// The applied version lives on the <style> element rather than in module state:
// the HTML entry and the per-module imports can load this shim under different
// URLs, and a slower, older response must never overwrite newer CSS.
const stylexProxiedDevCssShim = `
const STYLE_ID = ${JSON.stringify(stylexDevStyleId)};
const DEV_CSS_PATH = ${JSON.stringify(stylexDevCssPath)};
const VERSION_MARKER = ${JSON.stringify(stylexDevCssVersionMarker)};
const AFTER_UPDATE_DELAY = 180;
const WAIT_TIMEOUT = ${STYLE_WAIT_TIMEOUT};

function ensure() {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

function appliedVersion() {
  const el = document.getElementById(STYLE_ID);
  const value = el ? Number(el.dataset.version) : NaN;
  return Number.isFinite(value) ? value : -1;
}

function disableLink() {
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    if (typeof link.href === 'string' && link.href.includes(DEV_CSS_PATH)) {
      link.disabled = true;
    }
  }
}

function cssHref() {
  const moduleUrl = import.meta.url;
  const origin = moduleUrl.slice(0, moduleUrl.indexOf('/', moduleUrl.indexOf('//') + 2));
  return origin + DEV_CSS_PATH;
}

function readVersion(css) {
  const start = css.indexOf(VERSION_MARKER);
  if (start === -1 || start > 8) return -1;
  const value = Number.parseInt(css.slice(start + VERSION_MARKER.length), 10);
  return Number.isFinite(value) ? value : -1;
}

let inflight;

async function fetchAndApply() {
  try {
    // A hung request must not hold an in-flight slot that every later update reuses.
    const response = await fetch(cssHref() + '?t=' + Date.now(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(WAIT_TIMEOUT),
    });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.includes('text/css')) return false;
    const css = await response.text();
    if (!css) return false;
    const version = readVersion(css);
    const el = document.getElementById(STYLE_ID);
    if (el && version !== -1 && version <= appliedVersion()) return true;
    if (!el || el.textContent !== css) {
      const target = ensure();
      target.textContent = css;
      target.dataset.version = String(version);
    }
    disableLink();
    return true;
  } catch (error) {
    if (error && error.name === 'TimeoutError') {
      console.warn('[stylex] dev CSS took over ' + WAIT_TIMEOUT + 'ms; rendering without waiting for it');
    } else {
      console.error(error);
    }
    return false;
  }
}

function update() {
  if (!inflight) inflight = fetchAndApply().finally(() => (inflight = undefined));
  return inflight;
}

/**
 * Resolves once the page has CSS for rule-store version \`version\` or later.
 * Every StyleX module awaits it at top level in dev, so a lazy chunk's import()
 * settles only after its rules are applied, instead of rendering unstyled
 * class names until the update event's CSS arrives.
 */
export async function waitForStylexCss(version) {
  const deadline = Date.now() + WAIT_TIMEOUT;
  while (appliedVersion() < version && Date.now() < deadline) {
    // A request already in flight may predate this version; await it, then
    // start a fresh one if the store is still ahead of the page. The race keeps
    // the cap even while a request is still pending.
    const remaining = new Promise((resolve) => setTimeout(resolve, deadline - Date.now(), false));
    // A response without a version cannot prove progress; stop rather than poll.
    if (!(await Promise.race([update(), remaining])) || appliedVersion() === -1) return;
  }
}

update();

if (import.meta.hot) {
  import.meta.hot.on(${JSON.stringify(stylexCssUpdateEvent)}, update);
  import.meta.hot.on('vite:afterUpdate', () => setTimeout(update, AFTER_UPDATE_DELAY));
}
`;

export interface StylexDevCssOptions {
  /** Collects the CSS for every rule registered so far. */
  collectCss: () => string;
  /** Current version of the shared rule store; it increases with every rule change. */
  getVersion: () => number;
}

/**
 * Dev-only CSS delivery for StyleX. Must run before `@stylexjs/unplugin` (both are
 * `enforce: 'pre'`) so that its middleware and runtime module take precedence.
 */
export function stylexProxiedDevCssPlugin(options?: StylexDevCssOptions): Plugin {
  const resolvedId = `\0${stylexProxiedDevCssModuleId}`;
  const resolvedRuntimeId = `\0lobe-${stylexDevRuntimeId}`;
  return {
    apply: 'serve',
    configureServer(server) {
      if (!options) return;
      // Serves the unplugin's dev CSS path ahead of its own handler, prefixed with
      // the store version the shim compares against. The version is read first,
      // so the CSS includes at least every rule up to it.
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(stylexDevCssPath)) return next();
        const version = options.getVersion();
        const css = options.collectCss() || '';
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/css');
        res.setHeader('Cache-Control', 'no-store');
        res.end(`/*${stylexDevCssVersionMarker}${version}*/\n${css}`);
      });
    },
    enforce: 'pre',
    load(id) {
      if (id === resolvedId) return stylexProxiedDevCssShim;
      // The unplugin's runtime fetches its CSS without reporting a version; share
      // the shim instance the StyleX modules import instead.
      if (id === resolvedRuntimeId) return `import ${JSON.stringify(stylexProxiedDevCssModuleId)};`;
    },
    name: 'lobe-stylex-dev-css',
    resolveId(id) {
      if (id === stylexProxiedDevCssModuleId || id === resolvedId) return resolvedId;
      if (options && id.includes(stylexDevRuntimeId)) return resolvedRuntimeId;
    },
  };
}

/**
 * Appended to a dev StyleX module that registered rules: its evaluation, and so
 * any import() that reaches it, waits until the page has applied those rules.
 */
export const stylexDevCssWaitCode = (version: number) =>
  `\nimport { waitForStylexCss as __lobeWaitForStylexCss } from ${JSON.stringify(stylexProxiedDevCssModuleId)};\nawait __lobeWaitForStylexCss(${version});\n`;

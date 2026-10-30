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

// The proxied SPA's document origin is Next. A root-relative fetch of
// /virtual:stylex.css never reaches Vite, and the unplugin runtime then disables
// the stylesheet link that does. This module is served by Vite, so import.meta.url
// stays on that origin.
const stylexProxiedDevCssShim = `
const STYLE_ID = ${JSON.stringify(stylexDevStyleId)};
const DEV_CSS_PATH = ${JSON.stringify(stylexDevCssPath)};
const AFTER_UPDATE_DELAY = 180;
let lastCSS = '';

function ensure() {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
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

async function update() {
  try {
    const response = await fetch(cssHref() + '?t=' + Date.now(), { cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.includes('text/css')) return;
    const css = await response.text();
    if (!css || css === lastCSS) return;
    ensure().textContent = css;
    disableLink();
    lastCSS = css;
  } catch (error) {
    console.error(error);
  }
}

update();

if (import.meta.hot) {
  import.meta.hot.on(${JSON.stringify(stylexCssUpdateEvent)}, update);
  import.meta.hot.on('vite:afterUpdate', () => setTimeout(update, AFTER_UPDATE_DELAY));
}
`;

export function stylexProxiedDevCssPlugin(): Plugin {
  const resolvedId = `\0${stylexProxiedDevCssModuleId}`;
  return {
    apply: 'serve',
    load(id) {
      if (id === resolvedId) return stylexProxiedDevCssShim;
    },
    name: 'lobe-stylex-dev-css',
    resolveId(id) {
      if (id === stylexProxiedDevCssModuleId || id === resolvedId) return resolvedId;
    },
  };
}

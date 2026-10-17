import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  stylexDevCssPath,
  stylexDevRuntimeId,
  stylexProxiedDevCssModuleId,
  stylexProxiedDevCssPlugin,
} from './stylexDevCss';

const viteOrigin = 'http://localhost:9876';

const loadShim = () => {
  const plugin = stylexProxiedDevCssPlugin() as Plugin & {
    load: (id: string) => string | undefined;
    resolveId: (id: string) => string | undefined;
  };
  const code = plugin.load(String(plugin.resolveId(stylexProxiedDevCssModuleId)));
  if (!code) throw new Error('missing stylex dev css shim');
  return code;
};

// Runs the shim as the browser would after loading it from the Vite origin.
const runShim = () => {
  const meta = { url: `${viteOrigin}/@id/__x00__${stylexProxiedDevCssModuleId}` };
  new Function('__meta', loadShim().replaceAll('import.meta', '__meta'))(meta);
};

describe('stylexProxiedDevCssPlugin', () => {
  let link: HTMLLinkElement;

  beforeEach(() => {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${viteOrigin}${stylexDevCssPath}`;
    document.head.append(link);
  });

  afterEach(() => {
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('loads dev CSS from the Vite origin, not the proxied document origin', async () => {
    const fetchMock = vi.fn(
      async () => new Response('.lh1{color:red}', { headers: { 'content-type': 'text/css' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    runShim();

    await vi.waitFor(() => expect(link.disabled).toBe(true));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      new RegExp(`^${viteOrigin}${stylexDevCssPath}\\?t=\\d+$`),
    );
    expect(document.querySelector('style')?.textContent).toBe('.lh1{color:red}');
  });

  it('keeps the stylesheet link when the response is not CSS', async () => {
    const fetchMock = vi.fn(
      async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    runShim();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(link.disabled).toBeFalsy();
    expect(document.querySelector('style')).toBeNull();
  });
});

describe('@stylexjs/unplugin dev internals', () => {
  const unpluginLib = path.dirname(
    createRequire(import.meta.url).resolve('@stylexjs/unplugin/vite'),
  );
  const consts = createRequire(import.meta.url)(path.join(unpluginLib, 'consts.js')) as {
    DEV_CSS_PATH: string;
    VIRTUAL_STYLEX_RUNTIME_SCRIPT: string;
  };

  it('still match what the mirrored shim relies on', () => {
    const shim = loadShim();
    const viteHooks = readFileSync(path.join(unpluginLib, 'vite.js'), 'utf8');

    expect(consts.DEV_CSS_PATH).toBe(stylexDevCssPath);
    expect(viteHooks).toContain(`'/@id/${stylexDevRuntimeId}'`);
    for (const internal of ["'__stylex_virtual__'", "'stylex:css-update'"]) {
      expect(consts.VIRTUAL_STYLEX_RUNTIME_SCRIPT).toContain(internal);
      expect(shim).toContain(internal.replaceAll("'", '"'));
    }
  });
});

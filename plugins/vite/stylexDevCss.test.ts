import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  stylexDevCssPath,
  stylexDevCssVersionMarker,
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
  const body = loadShim().replaceAll('import.meta', '__meta').replace('export async', 'async');
  return new Function('__meta', `${body}\nreturn { waitForStylexCss };`)(meta) as {
    waitForStylexCss: (version: number) => Promise<void>;
  };
};

const cssResponse = (version: number, rules: string) =>
  new Response(`/*${stylexDevCssVersionMarker}${version}*/\n${rules}`, {
    headers: { 'content-type': 'text/css' },
  });

const appliedCss = () => document.getElementById('__stylex_virtual__')?.textContent;

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

  it('settles a module wait only after CSS of its rule version is applied', async () => {
    const responses = [cssResponse(1, '.lh-old{}'), cssResponse(3, '.lh-old{}.lh-new{}')];
    const fetchMock = vi.fn(async () => responses.shift() ?? cssResponse(3, '.lh-new{}'));
    vi.stubGlobal('fetch', fetchMock);

    const { waitForStylexCss } = runShim();
    await waitForStylexCss(3);

    expect(appliedCss()).toContain('.lh-new{}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops waiting after the cap when the CSS request never settles', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    try {
      const settled = vi.fn();
      runShim().waitForStylexCss(1).then(settled);
      await vi.advanceTimersByTimeAsync(5000);

      expect(settled).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait again for rules already applied', async () => {
    const fetchMock = vi.fn(async () => cssResponse(4, '.lh1{}'));
    vi.stubGlobal('fetch', fetchMock);

    const { waitForStylexCss } = runShim();
    await waitForStylexCss(4);
    await waitForStylexCss(2);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps newer CSS when an older response from another shim instance arrives later', async () => {
    let releaseOld: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseOld = resolve)))
      .mockImplementationOnce(async () => cssResponse(7, '.lh-new{}'));
    vi.stubGlobal('fetch', fetchMock);

    runShim();
    await runShim().waitForStylexCss(7);
    releaseOld(cssResponse(2, '.lh-old{}'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appliedCss()).toBe(`/*${stylexDevCssVersionMarker}7*/\n.lh-new{}`);
  });

  it('serves dev CSS prefixed with the rule version it was collected at', () => {
    let version = 11;
    const plugin = stylexProxiedDevCssPlugin({
      collectCss: () => {
        version += 1;
        return '.lh1{}';
      },
      getVersion: () => version,
    }) as Plugin & { configureServer: (server: unknown) => void };
    let middleware: (req: { url?: string }, res: unknown, next: () => void) => void = () => {};
    plugin.configureServer({ middlewares: { use: (fn: typeof middleware) => (middleware = fn) } });

    const res = { end: vi.fn(), setHeader: vi.fn(), statusCode: 0 };
    middleware({ url: `${stylexDevCssPath}?t=1` }, res, () => {});
    const next = vi.fn();
    middleware({ url: '/src/main.tsx' }, res, next);

    expect(res.end).toHaveBeenCalledWith(`/*${stylexDevCssVersionMarker}11*/\n.lh1{}`);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/css');
    expect(next).toHaveBeenCalledOnce();
  });

  it('serves the StyleX runtime id as the shared shim module', () => {
    const plugin = stylexProxiedDevCssPlugin({
      collectCss: () => '',
      getVersion: () => 0,
    }) as Plugin & {
      load: (id: string) => string | undefined;
      resolveId: (id: string) => string | undefined;
    };

    const runtime = plugin.load(String(plugin.resolveId(`/@id/${stylexDevRuntimeId}`)));

    expect(runtime).toBe(`import ${JSON.stringify(stylexProxiedDevCssModuleId)};`);
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

describe('debug proxy page', () => {
  it('swaps the StyleX dev runtime for the proxied CSS shim', () => {
    const html = readFileSync(
      path.resolve(import.meta.dirname, '../../public/_dangerous_local_dev_proxy.html'),
      'utf8',
    );

    expect(html).toContain(`srcPath.indexOf('${stylexDevRuntimeId}') !== -1`);
    expect(html).toContain(`srcPath = '/@id/${stylexProxiedDevCssModuleId}'`);
  });
});

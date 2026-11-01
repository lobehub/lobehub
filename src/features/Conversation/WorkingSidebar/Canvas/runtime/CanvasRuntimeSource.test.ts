import type { CanvasRuntimeManifest } from '@lobechat/canvas/runtime';
import { afterEach, expect, it, vi } from 'vitest';

import { CanvasRuntimeManager } from './CanvasRuntimeManager';
import { createCanvasRuntimeSource } from './CanvasRuntimeSource';

afterEach(() => vi.unstubAllGlobals());

it('loads optional graphs only on demand, shares their dependencies, and releases all code', async () => {
  const requests: string[] = [];
  let failAddon = true;
  const manifest: CanvasRuntimeManifest = {
    base: '/_spa/',
    entries: { runtime: 'runtime.js', highlight: 'highlight.js', mermaid: 'mermaid.js' },
    modules: ['runtime', 'highlight', 'mermaid', 'shared'].map((name) => ({
      id: `${name}.js`,
      imports: name === 'shared' ? [] : [{ start: 0, end: 1, target: 'shared.js' }],
    })),
    styles: ['ui.css'],
  };
  vi.stubGlobal('fetch', async (url: URL) => {
    requests.push(url.pathname);
    if (url.pathname === '/manifest.json') return Response.json(manifest);
    if (url.pathname.endsWith('highlight.js') && failAddon)
      return new Response('', { status: 503 });
    return new Response(url.pathname.endsWith('.css') ? 'a{background:url(./image.png)}' : 'code');
  });
  const manager = new CanvasRuntimeManager((signal) =>
    createCanvasRuntimeSource(new URL('https://app.test/manifest.json'), signal),
  );
  const first = manager.acquire();
  const second = manager.acquire();
  const base = await first.ready;
  expect(await second.ready).toBe(base);
  expect(requests).not.toContain('/_spa/highlight.js');
  expect(requests).not.toContain('/_spa/mermaid.js');
  expect(base.styles[0]).toContain('https://app.test/_spa/image.png');
  await expect(first.loadAddon('highlight')).rejects.toThrow('503');
  expect(base.modules).toHaveLength(2);
  failAddon = false;
  const addon = await second.loadAddon('highlight');
  expect(requests.filter((url) => url.endsWith('shared.js'))).toHaveLength(1);
  first.release();
  expect(addon.modules).toHaveLength(2);
  second.release();
  expect(base.modules).toEqual([]);
  expect(addon.modules).toEqual([]);
});

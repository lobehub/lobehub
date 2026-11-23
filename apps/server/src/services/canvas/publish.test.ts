// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCanvasPublicRuntimeUrl, resolvePublicRuntimeUrl } from './publish';

const revision = 'b'.repeat(64);

const serveManifest = (base: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === `${base}/v1/manifest.json`
        ? Response.json({ files: [], major: 1, revision })
        : new Response(null, { status: 404 }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe('resolvePublicRuntimeUrl', () => {
  it('points at the named file of the published revision', async () => {
    serveManifest('http://static.localhost/artboard-viewer');

    await expect(
      resolvePublicRuntimeUrl(1, 'http://static.localhost/artboard-viewer/', 'artboard-viewer.js'),
    ).resolves.toBe(`http://static.localhost/artboard-viewer/v1/${revision}/artboard-viewer.js`);
  });

  it('keeps the canvas runtime file name for canvases', async () => {
    serveManifest('http://static.localhost/canvas-runtime');

    await expect(
      resolveCanvasPublicRuntimeUrl(1, 'http://static.localhost/canvas-runtime'),
    ).resolves.toBe(`http://static.localhost/canvas-runtime/v1/${revision}/canvas-runtime.js`);
  });
});

// @vitest-environment node
import type { ArtboardPublishSnapshot, CanvasPublishBundle } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildArtboardPublishBundle } from './bundle';

const snapshot = (title = 'Onboarding'): ArtboardPublishSnapshot => ({
  boards: [],
  description: null,
  edges: [],
  groups: [],
  pages: [{ id: 'pg_1', name: 'Page 1', sortOrder: 0 }],
  publishedAt: '2026-11-17T00:00:00.000Z',
  rounds: [],
  title,
  version: 1,
});

const canvasBundle: CanvasPublishBundle = {
  files: [
    { content: 'body{}', contentType: 'text/css', encoding: 'utf8', path: '/style.css' },
    { content: '<p>detail</p>', contentType: 'text/html', encoding: 'utf8', path: '/detail.html' },
  ],
  html: '<html><head></head><body>entry</body></html>',
};

const viewerUrl = 'https://static.example.com/artboard-viewer/v1/abc/artboard-viewer.js';

const snapshotJsonOf = (html: string) =>
  JSON.parse(
    /<script type="application\/json" id="artboard-snapshot">([\s\S]*?)<\/script>/.exec(html)![1],
  );

describe('buildArtboardPublishBundle', () => {
  it('loads the viewer and embeds the snapshot in index.html', () => {
    const { html } = buildArtboardPublishBundle({
      canvases: [],
      images: [],
      snapshot: snapshot(),
      viewerUrl,
    });

    expect(html).toContain(`<script defer src="${viewerUrl}"></script>`);
    expect(snapshotJsonOf(html)).toEqual(snapshot());
    expect(html).toContain('<title>Onboarding</title>');
  });

  it('keeps a title that closes the script tag inside the JSON', () => {
    const title = '</script><script>alert(1)</script>\u2028';
    const { html } = buildArtboardPublishBundle({
      canvases: [],
      images: [],
      snapshot: snapshot(title),
      viewerUrl,
    });

    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(snapshotJsonOf(html).title).toBe(title);
    expect(html).toContain('<title>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('places each canvas version under its own directory', () => {
    const { files } = buildArtboardPublishBundle({
      canvases: [{ bundle: canvasBundle, canvasId: 'cvs_a', entry: 'app.html', version: 3 }],
      images: [],
      snapshot: snapshot(),
      viewerUrl,
    });
    const byPath = Object.fromEntries(files.map((file) => [file.path, file]));

    expect(Object.keys(byPath).toSorted()).toEqual([
      '/canvases/cvs_a/v3/app.html',
      '/canvases/cvs_a/v3/detail.html',
      '/canvases/cvs_a/v3/index.html',
      '/canvases/cvs_a/v3/style.css',
    ]);
    expect(byPath['/canvases/cvs_a/v3/index.html'].content).toBe(canvasBundle.html);
    expect(byPath['/canvases/cvs_a/v3/app.html'].content).toBe(canvasBundle.html);
  });

  it('writes the entry once when it is already index.html', () => {
    const { files } = buildArtboardPublishBundle({
      canvases: [{ bundle: canvasBundle, canvasId: 'cvs_a', entry: 'index.html', version: 1 }],
      images: [],
      snapshot: snapshot(),
      viewerUrl,
    });

    expect(files.filter((file) => file.path === '/canvases/cvs_a/v1/index.html')).toHaveLength(1);
  });

  it('stores images as base64 under images/', () => {
    const { files } = buildArtboardPublishBundle({
      canvases: [],
      images: [{ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', fileId: 'file_1' }],
      snapshot: snapshot(),
      viewerUrl,
    });

    expect(files).toEqual([
      { content: 'AQID', contentType: 'image/png', encoding: 'base64', path: '/images/file_1' },
    ]);
  });
});

// @vitest-environment node
import type { ArtboardPublishSnapshot } from '@lobechat/types';
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

const viewerUrl = 'https://static.example.com/artboard-viewer/v1/abc/artboard-viewer.js';

const snapshotJsonOf = (html: string) =>
  JSON.parse(
    /<script type="application\/json" id="artboard-snapshot">([\s\S]*?)<\/script>/.exec(html)![1],
  );

describe('buildArtboardPublishBundle', () => {
  it('loads the viewer and embeds the snapshot in index.html', () => {
    const { html } = buildArtboardPublishBundle({
      files: [],
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
      files: [],
      snapshot: snapshot(title),
      viewerUrl,
    });

    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(snapshotJsonOf(html).title).toBe(title);
    expect(html).toContain('<title>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('ships every artboard file as base64 under files/', () => {
    const { files } = buildArtboardPublishBundle({
      files: [
        {
          bytes: new TextEncoder().encode('<p>a</p>'),
          contentType: 'text/html',
          path: 'pages/a.html',
        },
        { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', path: 'shots/home@2x.png' },
      ],
      snapshot: snapshot(),
      viewerUrl,
    });

    expect(files).toEqual([
      {
        content: 'PHA+YTwvcD4=',
        contentType: 'text/html',
        encoding: 'base64',
        path: '/files/pages/a.html',
      },
      {
        content: 'AQID',
        contentType: 'image/png',
        encoding: 'base64',
        path: '/files/shots/home@2x.png',
      },
    ]);
  });
});

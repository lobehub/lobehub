import { describe, expect, it } from 'vitest';

import { gatherWorkspaceHtmlArtifact } from './gatherWorkspaceHtmlArtifact';
import type { ReadWorkspaceAssetResult } from './readWorkspaceAsset';

const textAsset = (text: string, contentType = 'text/plain'): ReadWorkspaceAssetResult => ({
  bytes: new TextEncoder().encode(text),
  contentType,
  ok: true,
  text,
});

describe('gatherWorkspaceHtmlArtifact', () => {
  it('publishes html plus collected local assets under the shared site root', async () => {
    const css = 'body { background: url("../images/bg.png"); }';
    const files = new Map<string, ReadWorkspaceAssetResult>([
      ['/project/pages/app.css', textAsset(css, 'text/css')],
      [
        '/project/images/bg.png',
        {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: 'image/png',
          ok: true,
        },
      ],
    ]);

    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: '<html><title>Demo</title><link rel="stylesheet" href="app.css"></html>',
      htmlFilePath: '/project/pages/index.html',
      readAsset: async (absolutePath) =>
        files.get(absolutePath) ?? { ok: false, reason: 'missing' },
      workingDirectory: '/project',
    });

    expect(result.identifier).toBe('workspace-html-pages-index-html');
    expect(result.title).toBe('Demo');
    expect(result.entryPath).toBe('pages/index.html');
    expect(result.files.map((file) => file.path).sort()).toEqual([
      'images/bg.png',
      'pages/app.css',
      'pages/index.html',
    ]);
    expect(result.files.find((file) => file.path === 'images/bg.png')).toMatchObject({
      encoding: 'base64',
      content: globalThis.btoa(String.fromCharCode(1, 2, 3)),
    });
    expect(result.blocked).toBeUndefined();
  });

  it('lists missing and oversized refs without blocking the rest', async () => {
    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent:
        '<html><link rel="stylesheet" href="app.css"><img src="gone.png"><img src="huge.png"></html>',
      htmlFilePath: '/project/index.html',
      readAsset: async (absolutePath) => {
        if (absolutePath.endsWith('app.css')) return textAsset('body{}', 'text/css');
        if (absolutePath.endsWith('huge.png')) return { ok: false, reason: 'oversized' };
        return { ok: false, reason: 'missing' };
      },
      workingDirectory: '/project',
    });

    expect(result.files.map((file) => file.path).sort()).toEqual(['app.css', 'index.html']);
    expect(result.missing).toEqual(['gone.png']);
    expect(result.oversized).toEqual(['huge.png']);
  });

  it('uses the same identifier when the same html path is gathered again', async () => {
    const first = await gatherWorkspaceHtmlArtifact({
      htmlContent: '<html></html>',
      htmlFilePath: '/project/pages/index.html',
      readAsset: async () => ({ ok: false, reason: 'missing' }),
      workingDirectory: '/project',
    });
    const second = await gatherWorkspaceHtmlArtifact({
      htmlContent: '<html><img src="logo.png"></html>',
      htmlFilePath: '/project/pages/index.html',
      readAsset: async () => ({
        bytes: new Uint8Array([9]),
        contentType: 'image/png',
        ok: true,
      }),
      workingDirectory: '/project',
    });

    expect(first.identifier).toBe(second.identifier);
  });

  it('publishes a standalone html file with no local or remote refs', async () => {
    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: '<html><title>Solo</title><body><p>Hello</p></body></html>',
      htmlFilePath: '/project/solo.html',
      readAsset: async () => ({ ok: false, reason: 'missing' }),
      workingDirectory: '/project',
    });

    expect(result.files.map((file) => file.path)).toEqual(['solo.html']);
    expect(result.remotes).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it('follows a vite script into hashed import.meta.url assets and public icons', async () => {
    const js = `
      const hero = new URL("hero-CLDdwZDr.png", import.meta.url);
      const icon = "/icons.svg#documentation-icon";
    `;
    const files = new Map<string, ReadWorkspaceAssetResult>([
      ['/project/dist/assets/index.js', textAsset(js, 'text/javascript')],
      [
        '/project/dist/assets/hero-CLDdwZDr.png',
        { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png', ok: true },
      ],
      ['/project/dist/icons.svg', textAsset('<svg></svg>', 'image/svg+xml')],
    ]);

    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent:
        '<html><title>Vite React Dist Probe</title><script type="module" src="./assets/index.js"></script></html>',
      htmlFilePath: '/project/dist/index.html',
      readAsset: async (absolutePath) =>
        files.get(absolutePath) ?? { ok: false, reason: 'missing' },
      workingDirectory: '/project',
    });

    expect(result.files.map((file) => file.path).sort()).toEqual([
      'assets/hero-CLDdwZDr.png',
      'assets/index.js',
      'icons.svg',
      'index.html',
    ]);
  });

  it('keeps remote urls out of the file set and lists them separately', async () => {
    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: `
        <html>
          <link rel="stylesheet" href="app.css">
          <script src="https://cdn.example.com/app.js"></script>
          <img src="//cdn.example.com/hero.png">
        </html>
      `,
      htmlFilePath: '/project/index.html',
      readAsset: async (absolutePath) =>
        absolutePath.endsWith('app.css')
          ? textAsset('body { background: url("https://cdn.example.com/bg.png"); }', 'text/css')
          : { ok: false, reason: 'missing' },
      workingDirectory: '/project',
    });

    expect(result.files.map((file) => file.path).sort()).toEqual(['app.css', 'index.html']);
    expect(result.remotes).toEqual([
      'https://cdn.example.com/app.js',
      '//cdn.example.com/hero.png',
      'https://cdn.example.com/bg.png',
    ]);
  });
});

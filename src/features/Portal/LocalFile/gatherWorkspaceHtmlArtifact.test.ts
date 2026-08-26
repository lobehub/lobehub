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

    expect(result.identifier).toBe('workspace-html-pages-index-html-6afd7f0435');
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

  it('blocks publishing when any referenced asset exceeds the hard site limit', async () => {
    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent:
        '<html><link rel="stylesheet" href="app.css"><img src="gone.png"><img src="huge.png"></html>',
      htmlFilePath: '/project/index.html',
      readAsset: async (absolutePath) => {
        if (absolutePath.endsWith('app.css')) return textAsset('body{}', 'text/css');
        if (absolutePath.endsWith('huge.png')) {
          return { ok: false, reason: 'oversized', sizeBytes: 51 * 1024 * 1024 };
        }
        return { ok: false, reason: 'missing' };
      },
      workingDirectory: '/project',
    });

    expect(result.blocked).toBe('too-large');
    expect(result.files).toEqual([]);
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

  it('resolves sibling assets when the html path is workspace-relative', async () => {
    const readPaths: string[] = [];
    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: '<html><link rel="stylesheet" href="./app.css"><img src="./dot.svg"></html>',
      htmlFilePath: 'index.html',
      readAsset: async (absolutePath) => {
        readPaths.push(absolutePath);
        if (absolutePath === '/tmp/site/app.css') return textAsset('body{}', 'text/css');
        if (absolutePath === '/tmp/site/dot.svg') return textAsset('<svg></svg>', 'image/svg+xml');
        return { ok: false, reason: 'missing' };
      },
      workingDirectory: '/tmp/site',
    });

    expect(readPaths.sort()).toEqual(['/tmp/site/app.css', '/tmp/site/dot.svg']);
    expect(result.files.map((file) => file.path).sort()).toEqual([
      'app.css',
      'dot.svg',
      'index.html',
    ]);
    expect(result.missing).toEqual([]);
  });

  it('collects sibling assets when Electron reports /private/tmp and the topic cwd is /tmp', async () => {
    const readPaths: string[] = [];
    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: '<html><link rel="stylesheet" href="./app.css"><img src="./dot.svg"></html>',
      htmlFilePath: '/private/tmp/lobe-html-publish-fixture/index.html',
      readAsset: async (absolutePath) => {
        readPaths.push(absolutePath);
        if (absolutePath === '/private/tmp/lobe-html-publish-fixture/app.css') {
          return textAsset('body{}', 'text/css');
        }
        if (absolutePath === '/private/tmp/lobe-html-publish-fixture/dot.svg') {
          return textAsset('<svg></svg>', 'image/svg+xml');
        }
        return { ok: false, reason: 'missing' };
      },
      workingDirectory: '/tmp/lobe-html-publish-fixture',
    });

    expect(readPaths.sort()).toEqual([
      '/private/tmp/lobe-html-publish-fixture/app.css',
      '/private/tmp/lobe-html-publish-fixture/dot.svg',
    ]);
    expect(result.files.map((file) => file.path).sort()).toEqual([
      'app.css',
      'dot.svg',
      'index.html',
    ]);
    expect(result.missing).toEqual([]);
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

  it('stops reading as soon as the file count limit is exceeded', async () => {
    const refs = Array.from({ length: 80 }, (_, index) => `<img src="a${index}.png">`).join('');
    let reads = 0;

    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: `<html>${refs}</html>`,
      htmlFilePath: '/project/index.html',
      readAsset: async () => {
        reads += 1;
        return { bytes: new Uint8Array([1]), contentType: 'image/png', ok: true };
      },
      workingDirectory: '/project',
    });

    expect(result.blocked).toBe('too-many');
    expect(reads).toBeLessThan(80);
  });

  it('stops reading as soon as the total byte limit is exceeded', async () => {
    const refs = Array.from({ length: 12 }, (_, index) => `<img src="b${index}.png">`).join('');
    let reads = 0;

    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: `<html>${refs}</html>`,
      htmlFilePath: '/project/index.html',
      readAsset: async () => {
        reads += 1;
        return { bytes: new Uint8Array(9 * 1024 * 1024), contentType: 'image/png', ok: true };
      },
      workingDirectory: '/project',
    });

    expect(result.blocked).toBe('too-large');
    expect(reads).toBe(10);
  });

  it('reads a file once when it is referenced through several spellings', async () => {
    const readPaths: string[] = [];

    const result = await gatherWorkspaceHtmlArtifact({
      htmlContent: '<html><img src="logo.png"><img src="./logo.png"></html>',
      htmlFilePath: '/project/index.html',
      readAsset: async (absolutePath) => {
        readPaths.push(absolutePath);
        return { bytes: new Uint8Array([1]), contentType: 'image/png', ok: true };
      },
      workingDirectory: '/project',
    });

    expect(readPaths).toEqual(['/project/logo.png']);
    expect(result.files.map((file) => file.path).sort()).toEqual(['index.html', 'logo.png']);
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

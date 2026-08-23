import { describe, expect, it } from 'vitest';

import { packWorkspaceHtmlDocument } from './packWorkspaceHtmlDocument';
import { WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES } from './readWorkspaceAsset';

describe('packWorkspaceHtmlDocument', () => {
  it('inlines small local css and images as data uris and leaves remotes', () => {
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'index.html',
      files: [
        {
          content:
            '<html><link rel="stylesheet" href="app.css"><img src="dot.png"><script src="https://cdn.example.com/app.js"></script></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
        {
          content: 'body { background: url("./dot.png"); color: #123456; }',
          contentType: 'text/css',
          encoding: 'utf8',
          path: 'app.css',
        },
        {
          content: globalThis.btoa(String.fromCharCode(1, 2, 3)),
          contentType: 'image/png',
          encoding: 'base64',
          path: 'dot.png',
        },
      ],
    });

    expect(packed.html).toContain('data:text/css;base64,');
    expect(packed.html).toContain('data:image/png;base64,AQID');
    expect(packed.html).toContain('https://cdn.example.com/app.js');
    expect(packed.html).not.toContain('href="app.css"');
    expect(packed.html).not.toContain('src="dot.png"');
    expect(packed.inlinedPaths).toEqual(['app.css', 'dot.png']);
    expect(packed.sidecars).toEqual([]);
    expect(packed.unresolvedHrefs).toEqual([]);
  });

  it('inlines svg as image/svg+xml even when the gathered type is text/plain', () => {
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'index.html',
      files: [
        {
          content: '<html><img alt="dot" src="./dot.svg"></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
        {
          content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          contentType: 'text/plain',
          encoding: 'utf8',
          path: 'dot.svg',
        },
      ],
    });

    expect(packed.html).toContain('data:image/svg+xml;base64,');
    expect(packed.html).not.toContain('data:text/plain');
    expect(packed.unresolvedHrefs).toEqual([]);
  });

  it('reports leftover relative files that were not packed', () => {
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'index.html',
      files: [
        {
          content:
            '<html><link rel="stylesheet" href="./app.css"><img alt="dot" src="./dot.svg"></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
      ],
    });

    expect(packed.html).toContain('href="./app.css"');
    expect(packed.html).toContain('src="./dot.svg"');
    expect(packed.unresolvedHrefs.sort()).toEqual(['./app.css', './dot.svg']);
  });

  it('rewrites unquoted html attributes so inlined files are not left behind', () => {
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'index.html',
      files: [
        {
          content: '<html><img src=dot.png alt=mark><link rel=stylesheet href=app.css></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
        {
          content: 'body { color: #111; }',
          contentType: 'text/css',
          encoding: 'utf8',
          path: 'app.css',
        },
        {
          content: globalThis.btoa(String.fromCharCode(1, 2, 3)),
          contentType: 'image/png',
          encoding: 'base64',
          path: 'dot.png',
        },
      ],
    });

    expect(packed.html).toContain('src=data:image/png;base64,AQID');
    expect(packed.html).toContain('href=data:text/css;base64,');
    expect(packed.html).not.toContain('src=dot.png');
    expect(packed.html).not.toContain('href=app.css');
    expect(packed.inlinedPaths).toEqual(['app.css', 'dot.png']);
    expect(packed.sidecars).toEqual([]);
  });

  it('rewrites refs that resolve through a local base element', () => {
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'pages/index.html',
      files: [
        {
          content: '<html><base href="../shared/"><img src="logo.png"></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'pages/index.html',
        },
        {
          content: globalThis.btoa(String.fromCharCode(1, 2, 3)),
          contentType: 'image/png',
          encoding: 'base64',
          path: 'shared/logo.png',
        },
      ],
    });

    expect(packed.html).toContain('data:image/png;base64,AQID');
    expect(packed.html).not.toContain('src="logo.png"');
    expect(packed.unresolvedHrefs).toEqual([]);
    expect(packed.inlinedPaths).toEqual(['shared/logo.png']);
  });

  it('rewrites every spelling of the same inlined file', () => {
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'index.html',
      files: [
        {
          content: '<html><img src="dot.png"><img src="./dot.png"></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
        {
          content: globalThis.btoa(String.fromCharCode(1, 2, 3)),
          contentType: 'image/png',
          encoding: 'base64',
          path: 'dot.png',
        },
      ],
    });

    expect(packed.html).not.toContain('src="dot.png"');
    expect(packed.html).not.toContain('src="./dot.png"');
    expect(packed.unresolvedHrefs).toEqual([]);
    expect(packed.inlinedPaths).toEqual(['dot.png']);
  });

  it('keeps files over the inline limit as uploaded sidecars', () => {
    const largePng = globalThis.btoa('x'.repeat(WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES + 8));
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'pages/index.html',
      files: [
        {
          content:
            '<html><img src="../images/hero.png"><link rel="stylesheet" href="app.css"></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'pages/index.html',
        },
        {
          content: 'body { color: #111; }',
          contentType: 'text/css',
          encoding: 'utf8',
          path: 'pages/app.css',
        },
        {
          content: largePng,
          contentType: 'image/png',
          encoding: 'base64',
          path: 'images/hero.png',
        },
      ],
    });

    expect(packed.html).toContain('src="/images/hero.png"');
    expect(packed.html).toContain('data:text/css;base64,');
    expect(packed.inlinedPaths).toEqual(['pages/app.css']);
    expect(packed.sidecars.map((file) => file.path)).toEqual(['images/hero.png']);
  });

  it('keeps js-referenced assets as sidecars so import.meta.url still resolves', () => {
    const packed = packWorkspaceHtmlDocument({
      entryPath: 'index.html',
      files: [
        {
          content:
            '<html><link rel="stylesheet" href="app.css"><script type="module" src="assets/index.js"></script></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
        {
          content: 'body { color: #111; }',
          contentType: 'text/css',
          encoding: 'utf8',
          path: 'app.css',
        },
        {
          content:
            'const hero = new URL("hero.png", import.meta.url); const icon = "/icons.svg#x";',
          contentType: 'text/javascript',
          encoding: 'utf8',
          path: 'assets/index.js',
        },
        {
          content: globalThis.btoa(String.fromCharCode(1, 2, 3)),
          contentType: 'image/png',
          encoding: 'base64',
          path: 'assets/hero.png',
        },
        {
          content: '<svg></svg>',
          contentType: 'image/svg+xml',
          encoding: 'utf8',
          path: 'icons.svg',
        },
      ],
    });

    expect(packed.html).toContain('data:text/css;base64,');
    expect(packed.html).toContain('src="/assets/index.js"');
    expect(packed.inlinedPaths).toEqual(['app.css']);
    expect(packed.sidecars.map((file) => file.path).sort()).toEqual([
      'assets/hero.png',
      'assets/index.js',
      'icons.svg',
    ]);
    expect(packed.sidecars.find((file) => file.path === 'assets/index.js')?.content).toContain(
      'new URL("hero.png", import.meta.url)',
    );
  });

  it('returns standalone html unchanged when there are no local assets', () => {
    const html = '<html><title>Solo</title><body><p>Hello</p></body></html>';

    expect(
      packWorkspaceHtmlDocument({
        entryPath: 'solo.html',
        files: [
          {
            content: html,
            contentType: 'text/html',
            encoding: 'utf8',
            path: 'solo.html',
          },
        ],
      }),
    ).toEqual({
      html,
      inlinedPaths: [],
      sidecars: [],
      unresolvedHrefs: [],
    });
  });
});

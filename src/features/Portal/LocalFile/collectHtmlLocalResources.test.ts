import { describe, expect, it } from 'vitest';

import { extractHtmlTitle } from '@/components/HtmlPreview/htmlTagScanner';

import { collectJsResourceHrefs, collectLocalResourceRefs } from './collectHtmlLocalResources';
import {
  createWorkspaceHtmlArtifactIdentifier,
  isPathInsideWorkspace,
  lowestCommonAncestorDirectory,
  resolveLocalResourceHref,
  toWorkspaceAbsolutePath,
  toWorkspaceRelativePath,
} from './workspaceHtmlPath';

describe('collectLocalResourceRefs', () => {
  const workingDirectory = '/project';
  const htmlFilePath = '/project/pages/index.html';

  it('collects static local stylesheet, script, and image refs', () => {
    const result = collectLocalResourceRefs({
      content: `
        <link rel="stylesheet" href="../assets/app.css">
        <script src="./main.js"></script>
        <img src="images/logo.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/assets/app.css',
      '/project/pages/images/logo.png',
      '/project/pages/main.js',
    ]);
  });

  it('collects srcset candidates and inline style urls', () => {
    const result = collectLocalResourceRefs({
      content: `
        <img srcset="img-1x.png 1x, img-2x.png 2x">
        <div style="background: url('bg.webp')"></div>
        <style>.hero { background-image: url("../shared/hero.jpg"); }</style>
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual(
      [
        '/project/pages/img-1x.png',
        '/project/pages/img-2x.png',
        '/project/pages/bg.webp',
        '/project/shared/hero.jpg',
      ].sort(),
    );
  });

  it('does not follow navigation links or remote urls', () => {
    const result = collectLocalResourceRefs({
      content: `
        <a href="about.html">About</a>
        <script src="https://cdn.example.com/app.js"></script>
        <img src="data:image/png;base64,abc">
        <img src="#logo">
        <link rel="stylesheet" href="//cdn.example.com/app.css">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([]);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual([
      'empty',
      'remote',
      'remote',
      'remote',
    ]);
  });

  it('rejects escaped paths and disallowed extensions', () => {
    const result = collectLocalResourceRefs({
      content: `
        <img src="../../.env">
        <img src="../secrets/key.pem">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([]);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual(['escape', 'extension']);
  });

  it('resolves root-relative paths against the working directory', () => {
    const result = collectLocalResourceRefs({
      content: '<link rel="stylesheet" href="/assets/app.css">',
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([
      { absolutePath: '/project/assets/app.css', href: '/assets/app.css' },
    ]);
  });

  it('treats every ref as remote when html has an absolute base', () => {
    const result = collectLocalResourceRefs({
      content: `
        <base href="https://cdn.example.com/app/">
        <link rel="stylesheet" href="app.css">
        <link rel="stylesheet" href="/assets/local.css">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([]);
    expect(result.skipped).toContainEqual({ href: 'app.css', reason: 'remote' });
    expect(result.skipped).toContainEqual({ href: '/assets/local.css', reason: 'remote' });
  });

  it('resolves a relative base against the html file', () => {
    const result = collectLocalResourceRefs({
      content: `
        <base href="../shared/">
        <img src="logo.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([{ absolutePath: '/project/shared/logo.png', href: 'logo.png' }]);
  });

  it('collects css url and import refs from the stylesheet directory', () => {
    const result = collectLocalResourceRefs({
      content: `
        @import "./theme.css";
        body { background: url("../images/bg.png"); }
      `,
      sourceKind: 'css',
      sourcePath: '/project/pages/css/app.css',
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/pages/css/theme.css',
      '/project/pages/images/bg.png',
    ]);
  });

  it('collects vite-style import.meta.url and root-absolute assets from js', () => {
    const result = collectLocalResourceRefs({
      content: `
        const hero = new URL(\`hero-CLDdwZDr.png\`, import.meta.url);
        const logo = new URL("react.svg",import.meta.url);
        const icon = "/icons.svg#documentation-icon";
        const skip = "https://cdn.example.com/app.js";
      `,
      rootDirectory: '/project/dist',
      sourceKind: 'js',
      sourcePath: '/project/dist/assets/index.js',
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/dist/assets/hero-CLDdwZDr.png',
      '/project/dist/assets/react.svg',
      '/project/dist/icons.svg',
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('dedupes identical refs but keeps every spelling of the same file', () => {
    const result = collectLocalResourceRefs({
      content: '<img src="logo.png"><img src="logo.png"><img src="./logo.png">',
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([
      { absolutePath: '/project/pages/logo.png', href: 'logo.png' },
      { absolutePath: '/project/pages/logo.png', href: './logo.png' },
    ]);
  });
});

describe('collectJsResourceHrefs', () => {
  it('reads backtick new URL and strips svg sprite hashes', () => {
    expect(
      collectJsResourceHrefs(
        'd=``+new URL(`hero-CLDdwZDr.png`,import.meta.url).href;use.href=`/icons.svg#documentation-icon`',
      ),
    ).toEqual(['hero-CLDdwZDr.png', '/icons.svg']);
  });
});

describe('path helpers', () => {
  it('keeps workspace containment strict', () => {
    expect(isPathInsideWorkspace('/project/pages/a.html', '/project')).toBe(true);
    expect(isPathInsideWorkspace('/project-other/a.html', '/project')).toBe(false);
  });

  it('treats macOS /private/tmp and /tmp as the same workspace', () => {
    expect(
      isPathInsideWorkspace(
        '/private/tmp/lobe-html-publish-fixture/app.css',
        '/tmp/lobe-html-publish-fixture',
      ),
    ).toBe(true);
    expect(
      isPathInsideWorkspace(
        '/tmp/lobe-html-publish-fixture/app.css',
        '/private/tmp/lobe-html-publish-fixture',
      ),
    ).toBe(true);
    expect(isPathInsideWorkspace('/private/tmp-other/app.css', '/tmp')).toBe(false);

    expect(
      resolveLocalResourceHref({
        href: './app.css',
        sourcePath: '/private/tmp/lobe-html-publish-fixture/index.html',
        workingDirectory: '/tmp/lobe-html-publish-fixture',
      }),
    ).toEqual({
      absolutePath: '/private/tmp/lobe-html-publish-fixture/app.css',
      href: './app.css',
      kind: 'resolved',
    });

    expect(
      toWorkspaceRelativePath(
        '/private/tmp/lobe-html-publish-fixture/index.html',
        '/tmp/lobe-html-publish-fixture',
      ),
    ).toBe('index.html');
    expect(
      toWorkspaceAbsolutePath(
        '/private/tmp/lobe-html-publish-fixture/index.html',
        '/tmp/lobe-html-publish-fixture',
      ),
    ).toBe('/private/tmp/lobe-html-publish-fixture/index.html');
  });

  it('computes the lowest common ancestor inside the workspace', () => {
    expect(
      lowestCommonAncestorDirectory(
        ['/project/pages/index.html', '/project/pages/css/app.css'],
        '/project',
      ),
    ).toBe('/project/pages');
    expect(
      lowestCommonAncestorDirectory(
        ['/project/pages/index.html', '/project/shared/logo.png'],
        '/project',
      ),
    ).toBe('/project');
  });

  it('builds a stable artifact identifier from the html relative path', () => {
    expect(createWorkspaceHtmlArtifactIdentifier('pages/index.html')).toBe(
      'workspace-html-pages-index-html-6afd7f0435',
    );
    expect(createWorkspaceHtmlArtifactIdentifier('pages/index.html')).toBe(
      createWorkspaceHtmlArtifactIdentifier('pages/index.html'),
    );
    expect(createWorkspaceHtmlArtifactIdentifier('页面.html')).not.toBe(
      createWorkspaceHtmlArtifactIdentifier('报告.html'),
    );
    expect(createWorkspaceHtmlArtifactIdentifier('a/b.html')).not.toBe(
      createWorkspaceHtmlArtifactIdentifier('a-b.html'),
    );
  });

  it('extracts a title and returns undefined when missing', () => {
    expect(extractHtmlTitle('<html><title> Demo Page </title></html>')).toBe('Demo Page');
    expect(extractHtmlTitle('<html></html>')).toBeUndefined();
  });

  it('resolves windows-style relative hrefs', () => {
    expect(
      resolveLocalResourceHref({
        href: 'assets\\logo.png',
        sourcePath: 'C:\\repo\\pages\\index.html',
        workingDirectory: 'C:\\repo',
      }),
    ).toEqual({
      absolutePath: 'C:\\repo\\pages\\assets\\logo.png',
      href: 'assets\\logo.png',
      kind: 'resolved',
    });
  });

  it('returns the workspace-relative path', () => {
    expect(toWorkspaceRelativePath('/project/pages/index.html', '/project')).toBe(
      'pages/index.html',
    );
  });

  it('joins a workspace-relative html path onto the working directory', () => {
    expect(toWorkspaceAbsolutePath('index.html', '/tmp/site')).toBe('/tmp/site/index.html');
    expect(toWorkspaceAbsolutePath('/tmp/site/index.html', '/tmp/site')).toBe(
      '/tmp/site/index.html',
    );
  });
});

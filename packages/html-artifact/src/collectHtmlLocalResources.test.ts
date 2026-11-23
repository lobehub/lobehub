import { describe, expect, it } from 'vitest';

import {
  collectCssResourceHrefs,
  collectJsResourceHrefs,
  collectLocalResourceRefs,
} from './collectHtmlLocalResources';
import { extractHtmlTitle, findOpeningTag, removeLocalBaseTag } from './htmlTagScanner';
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

  it('keeps a base that escapes the workspace so its refs report the real files', () => {
    const escaped = {
      content: `
        <base href="../../shared/">
        <img src="logo.png">
      `,
      sourceKind: 'html' as const,
      sourcePath: htmlFilePath,
      workingDirectory,
    };

    expect(collectLocalResourceRefs(escaped).skipped).toContainEqual({
      absolutePath: '/shared/logo.png',
      href: 'logo.png',
      reason: 'escape',
    });
    expect(collectLocalResourceRefs({ ...escaped, allowExternalReads: true }).refs).toEqual([
      { absolutePath: '/shared/logo.png', href: 'logo.png' },
    ]);
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

  it('ignores HTML comments with apostrophes and commented-out resource tags', () => {
    const result = collectLocalResourceRefs({
      content: `
        <!-- Don't edit this section -->
        <!--
          <link rel="stylesheet" href="./old.css">
          <img src="./deleted.png">
          <div style="background: url('./dead-inline.png')"></div>
          <style>.old { background: url('./dead-style.png'); }</style>
        -->
        <!--><!--->
        <link rel="stylesheet" href="./app.css">
        <img src="./hero.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/pages/app.css',
      '/project/pages/hero.png',
    ]);
  });

  it('recognizes --!> as an HTML comment terminator', () => {
    const result = collectLocalResourceRefs({
      content: `
        <!-- closed --!><img src="./first.png">
        <!-- standard --><img src="./second.png">
        <!-- trailing --!><img src="./third.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/pages/first.png',
      '/project/pages/second.png',
      '/project/pages/third.png',
    ]);
    expect(findOpeningTag('<!-- closed --!><head></head>', 'head')?.text).toBe('<head>');
    expect(extractHtmlTitle('<!-- closed --!><title>Live Title</title>')).toBe('Live Title');
  });

  it('consumes bogus comments and declarations before resuming tag scanning', () => {
    const result = collectLocalResourceRefs({
      content: `
        <!foo <img src="./dead-bang.png">><img src="./live-bang.png">
        <?xml <img src="./dead-pi.png"> ?><img src="./live-pi.png">
        </123 <img src="./dead-end.png">><img src="./live-end.png">
        <svg><desc><![CDATA[ a > <img src="./dead-cdata.png"> ]]></desc></svg>
        <img src="./live-cdata.png">
        <!unclosed <img src="./dead-eof.png"
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/pages/live-bang.png',
      '/project/pages/live-cdata.png',
      '/project/pages/live-end.png',
      '/project/pages/live-pi.png',
    ]);
    expect(
      findOpeningTag(
        '<!foo <base href="https://dead.example.com/">><base href="../shared/">',
        'base',
      )?.text,
    ).toBe('<base href="../shared/">');
  });

  it('keeps scanning after self-closing foreign raw-text tags while keeping HTML raw-text rules', () => {
    const result = collectLocalResourceRefs({
      content: `
        <svg><title /></svg><img src="./after-svg-title.png">
        <svg><style /></svg><img src="./after-svg-style.png">
        <svg><script href="./svg-script.js" /></svg><img src="./after-svg-script.png">
        <math><title /></math><img src="./after-math-title.png">
        <svg><foreignObject><script />const s = '<img src="./dead-in-fo.png">';</script></foreignObject><title /></svg>
        <img src="./after-fo.png">
        <svg><p><script />const s = '<img src="./dead-after-breakout.png">';</script></p>
        <img src="./after-breakout.png">
        <svg /><script />const s = '<img src="./dead-html-script.png">';</script>
        <img src="./after-html-script.png">
        <title /><img src="./dead-html-title.png"></title>
        <img src="./after-html-title.png">
        <svg><script data-x=foo/>const s = '<img src="./dead-unquoted.png">';</script></svg>
        <img src="./after-unquoted.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/pages/after-breakout.png',
      '/project/pages/after-fo.png',
      '/project/pages/after-html-script.png',
      '/project/pages/after-html-title.png',
      '/project/pages/after-math-title.png',
      '/project/pages/after-svg-script.png',
      '/project/pages/after-svg-style.png',
      '/project/pages/after-svg-title.png',
      '/project/pages/after-unquoted.png',
      '/project/pages/svg-script.js',
    ]);
    expect(
      collectLocalResourceRefs({
        content: '<script /><img src="./dead-unclosed-html-script.png">',
        sourceKind: 'html',
        sourcePath: htmlFilePath,
        workingDirectory,
      }).refs,
    ).toEqual([]);
    expect(findOpeningTag('<svg><title /></svg><base href="../shared/">', 'base')?.text).toBe(
      '<base href="../shared/">',
    );
    expect(extractHtmlTitle('<svg><title /></svg><title>Real Page</title>')).toBe('Real Page');
  });

  it('does not scan inline script or style bodies as HTML tags', () => {
    const result = collectLocalResourceRefs({
      content: `
        <script>
          for (let i = 0; i < items.length; i++) {
            // don't mutate in place
            const tpl = '<img src="./fake.png"><div style="background: url(fake-bg.png)">';
          }
        </script>
        <style>
          /* a < b; don't break */
          .hero { background: url("./bg.png"); }
        </style>
        <img src="./real.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs.map((ref) => ref.absolutePath).sort()).toEqual([
      '/project/pages/bg.png',
      '/project/pages/real.png',
    ]);
  });

  it('keeps scanning past bare < comparisons and apostrophes in text content', () => {
    const result = collectLocalResourceRefs({
      content: `
        <p>İstanbul: when x < 10, it's small.</p>
        <p>Also Map<string, number> and a<b work.</p>
        <img alt="a > b" src="./chart.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([
      { absolutePath: '/project/pages/chart.png', href: './chart.png' },
    ]);
  });

  it('ignores base tags inside HTML comments and scripts', () => {
    const result = collectLocalResourceRefs({
      content: `
        <!-- <base href="https://old.example.com/"> -->
        <script>const html = '<base href="https://script.example.com/">';</script>
        <img src="./logo.png">
      `,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([{ absolutePath: '/project/pages/logo.png', href: './logo.png' }]);
    expect(result.skipped).toEqual([]);
  });

  it('stays linear on repeated unclosed comment openers', () => {
    const pathological = `<img src="./ok.png">${'<!--'.repeat(40_000)}`;
    const started = Date.now();
    const result = collectLocalResourceRefs({
      content: pathological,
      sourceKind: 'html',
      sourcePath: htmlFilePath,
      workingDirectory,
    });

    expect(result.refs).toEqual([{ absolutePath: '/project/pages/ok.png', href: './ok.png' }]);
    expect(Date.now() - started).toBeLessThan(1000);
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
    expect(
      lowestCommonAncestorDirectory(
        ['/project/pages/index.html', '/outside/assets/logo.png'],
        '/project',
      ),
    ).toBe('/');
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
    expect(
      extractHtmlTitle(
        '<!-- <title>Old</title> --><html><title lang="en"> Real Page </title></html>',
      ),
    ).toBe('Real Page');
    expect(extractHtmlTitle('<html></html>')).toBeUndefined();
  });

  it('finds and removes real opening tags while skipping HTML comments and scripts', () => {
    const html =
      '<!-- <head><base href="../old/"></head> --><script>const x = "<base href=x>";</script><html><head><base href="../shared/"></head></html>';

    expect(findOpeningTag(html, 'head')).toEqual({
      end: html.indexOf('<base href="../shared/">'),
      start: html.indexOf('<head><base href="../shared/">'),
      text: '<head>',
    });
    expect(removeLocalBaseTag(html)).toBe(
      '<!-- <head><base href="../old/"></head> --><script>const x = "<base href=x>";</script><html><head></head></html>',
    );
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
  it('strips css comments without going quadratic on unterminated openers', () => {
    const css = `
      @import "kept.css";
      /* a comment with url("ignored.png") inside */
      body { background: url("used.png"); }
    `;

    expect(collectCssResourceHrefs(css)).toEqual(['kept.css', 'used.png']);

    // A sheet of unclosed openers is what makes the lazy regex backtrack; the
    // scanner must return promptly and treat the first opener as running to EOF.
    const pathological = `body{background:url("late.png")}${'a/*'.repeat(40_000)}`;
    const started = Date.now();
    expect(collectCssResourceHrefs(pathological)).toEqual(['late.png']);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

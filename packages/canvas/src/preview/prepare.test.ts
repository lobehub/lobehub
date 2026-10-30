import { describe, expect, it } from 'vitest';

import { prepareCanvasProject } from './prepare';

const project = (files: Record<string, string>) => ({
  entry: 'index.html',
  files: Object.entries(files).map(([path, content]) => ({
    content,
    contentType: 'text/plain',
    encoding: 'utf8' as const,
    path,
  })),
});

describe('prepareCanvasProject', () => {
  it.each([
    ['with', 'var result; with ({value: 7}) { result=value; }', 7],
    ['legacy octal', 'var result=010;', 8],
    ['await binding', 'var await=42; var result=await;', 42],
  ])('preserves classic %s scripts inline and in files', (_name, source, expected) => {
    const result = prepareCanvasProject(
      project({
        'index.html': `<script>${source}</script><script src="classic.js"></script>`,
        'classic.js': String(source),
      }),
    );

    expect(result.files['index.html'].content).toContain(source);
    expect(new Function(`${result.files['classic.js'].content}; return result;`)()).toBe(expected);
  });

  it('resolves resources against their own file, including CSS imports and component JSON', () => {
    const result = prepareCanvasProject(
      project({
        'index.html':
          '<link href="css/app.css" rel="stylesheet"><img src="img/a.svg#icon"><lobe-chart data-src="data/chart.json"></lobe-chart>',
        'css/app.css': '@import "theme.css"; .hero{background:url(../img/a.svg)}',
        'css/theme.css': 'body{color:inherit}',
        'img/a.svg': '<svg/>',
        'data/chart.json': '[]',
      }),
    );

    expect(result.files['index.html'].content).toContain('lobe-canvas-file/css%2Fapp.css');
    expect(result.files['index.html'].content).toContain('lobe-canvas-file/img%2Fa.svg#icon');
    expect(result.files['index.html'].content).toContain('lobe-canvas-file/data%2Fchart.json');
    expect(result.files['css/app.css'].content).toContain('lobe-canvas-file/css%2Ftheme.css');
    expect(result.files['css/app.css'].content).toContain('lobe-canvas-file/img%2Fa.svg');
  });

  it('links cyclic modules, dynamic imports and import.meta resource URLs without changing text', () => {
    const result = prepareCanvasProject(
      project({
        'index.html': '<script type="module" src="js/main.js"></script>',
        'js/main.js':
          'import {value} from "./other.js"; const text="import ./other.js"; export const load=p=>import(p); const image=new URL("../img/a.svg", import.meta.url);',
        'js/other.js': 'export {load} from "./main.js"; export const value=1;',
        'img/a.svg': '<svg/>',
      }),
    );

    expect(result.files['js/main.js'].content).toContain('"lobe-canvas-project/js/other.js"');
    expect(result.files['js/main.js'].content).toContain('text="import ./other.js"');
    expect(result.files['js/main.js'].content).toContain('__LOBE_CANVAS_IMPORT__("js/main.js",p)');
    expect(result.files['js/main.js'].content).toContain(
      '__LOBE_CANVAS_URL__("js/main.js","../img/a.svg")',
    );
    expect(result.files['js/other.js'].content).toContain('"lobe-canvas-project/js/main.js"');
  });

  it('keeps anchors and external links while routing project pages inside the preview', () => {
    const result = prepareCanvasProject(
      project({
        'index.html':
          '<a href="pages/detail.html#title">Detail</a><a href="#here">Here</a><a href="https://example.com">External</a>',
        'pages/detail.html': '<h1 id="title">Detail</h1>',
      }),
    );
    expect(result.files['index.html'].content).toContain(
      'lobe-canvas-page/pages%2Fdetail.html#title',
    );
    expect(result.files['index.html'].content).toContain('href="#here"');
    expect(result.files['index.html'].content).toContain('href="https://example.com"');
  });

  it('rejects missing local imports rather than requesting them from the app origin', () => {
    expect(() =>
      prepareCanvasProject(
        project({
          'index.html': '<script type="module">import "./missing.js"</script>',
        }),
      ),
    ).toThrow(/missing.js/);
  });

  it('preserves data URLs in srcset while resolving file candidates', () => {
    const result = prepareCanvasProject(
      project({
        'index.html': '<img srcset="data:image/png;base64,aGVsbG8= 1x, image.png 2x">',
        'image.png': 'image',
      }),
    );
    expect(result.files['index.html'].content).toContain('data:image/png;base64,aGVsbG8= 1x');
    expect(result.files['index.html'].content).toContain('lobe-canvas-file/image.png 2x');
  });
});

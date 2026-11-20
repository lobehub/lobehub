import { describe, expect, it } from 'vitest';

import { checkCanvasMermaid } from '../mermaid';
import { CANVAS_LIMITS } from '../project/limits';
import { CANVAS_COMPONENTS } from '../schema/components';
import { validateCanvasProject } from './validateCanvasProject';

const page = (body: string) =>
  `<!doctype html><html><head><title>R</title></head><body>${body}</body></html>`;

const run = (files: Record<string, string | Uint8Array>) =>
  validateCanvasProject(Object.entries(files).map(([path, content]) => ({ content, path })));

const rules = (files: Record<string, string | Uint8Array>) => run(files).issues.map((i) => i.rule);

describe('validateCanvasProject', () => {
  it('accepts a valid multi-file project', () => {
    const result = run({
      'data/cost.json': '[{"m":"Sep","v":1}]',
      'index.html': page(`
        <lobe-alert type="info" title="Up 23%">Opus drove it.</lobe-alert>
        <lobe-grid rows="3" gap="12">
          <lobe-stat title="Total" value="18420" prefix="$" trend="up"></lobe-stat>
        </lobe-grid>
        <lobe-line-chart index="m" categories='["v"]' data-src="./data/cost.json"></lobe-line-chart>
        <lobe-select id="r" value="7d"><lobe-option value="7d">7 days</lobe-option></lobe-select>
        <img src="assets/logo.png">
        <a href="detail.html">Detail</a>
        <script src="./app.js"></script>
      `),
      'app.js': 'document.querySelector("#r").addEventListener("lobe-change", () => {});',
      'assets/logo.png': new Uint8Array([1, 2, 3]),
      'detail.html': page('<p>detail</p>'),
    });

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('requires an index.html entry', () => {
    expect(rules({ 'a.html': page('') })).toContain('entry-missing');
  });

  it('rejects unknown lobe tags with a suggestion', () => {
    const { issues } = run({ 'index.html': page('<lobe-stats title="a" value="1"></lobe-stats>') });

    expect(issues[0]).toMatchObject({ file: 'index.html', rule: 'unknown-component' });
    expect(issues[0].message).toContain('lobe-stat');
  });

  it('reports the line of the offending tag', () => {
    const { issues } = run({
      'index.html': '<html>\n<body>\n<lobe-nope></lobe-nope>\n</body></html>',
    });

    expect(issues[0]).toMatchObject({ line: 3, rule: 'unknown-component' });
  });

  it('rejects unknown attributes but allows global ones', () => {
    expect(
      rules({
        'index.html': page('<lobe-tag color="green" id="t" data-x="1" aria-label="t">x</lobe-tag>'),
      }),
    ).toEqual([]);
    expect(rules({ 'index.html': page('<lobe-tag colour="green">x</lobe-tag>') })).toEqual([
      'unknown-attribute',
    ]);
  });

  it('checks attribute types', () => {
    expect(rules({ 'index.html': page('<lobe-stat title="a" value="lots"></lobe-stat>') })).toEqual(
      ['invalid-attribute'],
    );
    expect(rules({ 'index.html': page('<lobe-alert type="danger">x</lobe-alert>') })).toEqual([
      'invalid-attribute',
    ]);
    expect(
      rules({ 'index.html': page(`<lobe-table columns='[{"title":"a"' data='[]'></lobe-table>`) }),
    ).toEqual(['invalid-attribute']);
    expect(rules({ 'index.html': page('<lobe-switch checked="yes"></lobe-switch>') })).toEqual([
      'invalid-attribute',
    ]);
  });

  it('requires required attributes from an attribute, a -src file or a JSON child script', () => {
    expect(rules({ 'index.html': page('<lobe-stat title="a"></lobe-stat>') })).toEqual([
      'missing-attribute',
    ]);
    expect(
      rules({
        'index.html': page(`
          <lobe-bar-list>
            <script type="application/json" data-prop="data">[{"name":"a","value":1}]</script>
          </lobe-bar-list>`),
      }),
    ).toEqual([]);
    expect(
      rules({ 'index.html': page('<lobe-bar-list data-src="missing.json"></lobe-bar-list>') }),
    ).toEqual(['broken-reference']);
  });

  it('rejects invalid JSON in a -src file and in a JSON child script', () => {
    expect(
      rules({
        'bad.json': '{nope',
        'index.html': page('<lobe-bar-list data-src="bad.json"></lobe-bar-list>'),
      }),
    ).toEqual(['invalid-attribute']);
    expect(
      rules({
        'index.html': page(
          '<lobe-bar-list><script type="application/json" data-prop="data">{nope</script></lobe-bar-list>',
        ),
      }),
    ).toEqual(['invalid-attribute']);
  });

  it('only allows option-like children inside their parents', () => {
    expect(rules({ 'index.html': page('<lobe-option value="a">A</lobe-option>') })).toEqual([
      'misplaced-component',
    ]);
  });

  it('rejects chart colors outside the palette', () => {
    expect(
      rules({
        'index.html': page(
          `<lobe-bar-chart index="a" categories='["b"]' data='[]' colors='["#ff0000"]'></lobe-bar-chart>`,
        ),
      }),
    ).toEqual(['invalid-attribute']);
  });

  it('rejects hard-coded colors in inline styles of lobe components', () => {
    expect(
      rules({ 'index.html': page('<lobe-card style="background:#fff;padding:8px">x</lobe-card>') }),
    ).toEqual(['hard-coded-color']);
    expect(
      rules({ 'index.html': page('<lobe-card style="color: rgb(0,0,0)">x</lobe-card>') }),
    ).toEqual(['hard-coded-color']);
    expect(
      rules({
        'index.html': page('<lobe-card style="color: var(--lobe-color-text)">x</lobe-card>'),
      }),
    ).toEqual([]);
  });

  it('rejects network APIs in inline scripts and JS files', () => {
    expect(rules({ 'index.html': page('<script>fetch("https://x.dev")</script>') })).toEqual([
      'network-api',
    ]);
    expect(
      rules({
        'index.html': page('<script src="a.js"></script>'),
        'a.js': 'const ws = new WebSocket("wss://x")',
      }),
    ).toEqual(['network-api']);
  });

  it('rejects remote resources but allows data URIs and external links', () => {
    expect(
      rules({ 'index.html': page('<script src="https://cdn.example.com/x.js"></script>') }),
    ).toEqual(['remote-resource']);
    expect(rules({ 'index.html': page('<img src="https://example.com/a.png">') })).toEqual([
      'remote-resource',
    ]);
    expect(
      rules({
        'index.html': page(
          '<img src="data:image/png;base64,AA=="><a href="https://lobehub.com">x</a>',
        ),
      }),
    ).toEqual([]);
  });

  it('rejects broken relative references', () => {
    expect(rules({ 'index.html': page('<img src="./a.png">') })).toEqual(['broken-reference']);
    expect(
      rules({
        'index.html': page('<link rel="stylesheet" href="css/app.css">'),
        'css/app.css': 'body{background:url(../img/bg.png)}',
      }),
    ).toEqual(['broken-reference']);
  });

  it.each(['/image.png', '/image.png?v=1#preview', '\\image.png'])(
    'rejects root-relative HTML resources even when the project has the file: %s',
    (href) => {
      expect(
        rules({
          'image.png': new Uint8Array([1, 2, 3]),
          'index.html': page(`<img src="${href}">`),
        }),
      ).toEqual(['broken-reference']);
    },
  );

  it('rejects root-relative references in CSS assets', () => {
    expect(
      rules({
        'app.css': 'body{background-image:url(/image.png)}',
        'image.png': new Uint8Array([1, 2, 3]),
        'index.html': page('<link rel="stylesheet" href="app.css">'),
      }),
    ).toEqual(['broken-reference']);
  });

  it('rejects unsafe paths and disallowed file types', () => {
    expect(rules({ '../x.html': '', 'index.html': page('') })).toEqual(['invalid-path']);
    expect(rules({ 'index.html': page(''), 'run.exe': new Uint8Array([0]) })).toEqual([
      'invalid-path',
    ]);
  });

  it('trusts a known size for files whose bytes were not loaded', () => {
    const result = validateCanvasProject([
      { content: page('<img src="big.png">'), path: 'index.html' },
      { content: new Uint8Array(0), path: 'big.png', size: CANVAS_LIMITS.maxFileBytes + 1 },
    ]);

    expect(result.issues.map((issue) => issue.rule)).toEqual(['file-too-large']);
  });

  it('enforces size and count limits', () => {
    const many: Record<string, string> = { 'index.html': page('') };
    for (let i = 0; i < CANVAS_LIMITS.maxFiles; i += 1) many[`f${i}.json`] = '[]';
    expect(rules(many)).toContain('too-many-files');

    expect(
      rules({
        'big.png': new Uint8Array(CANVAS_LIMITS.maxFileBytes + 1),
        'index.html': page(''),
      }),
    ).toContain('file-too-large');
  });
});

describe('validateCanvasProject · text components', () => {
  const runWithMermaid = (html: string) =>
    validateCanvasProject([{ content: html, path: 'index.html' }], {
      checkMermaid: checkCanvasMermaid,
    });

  it('accepts the documented code and diagram examples', () => {
    const examples = CANVAS_COMPONENTS.filter((spec) => spec.children === 'text')
      .map((spec) => spec.example)
      .join('\n');

    expect(runWithMermaid(page(examples)).issues).toEqual([]);
  });

  it('rejects markup inside code, which the browser would swallow as an element', () => {
    const { issues } = run({
      'index.html':
        '<html>\n<body>\n<lobe-code language="ts">\nconst x: Array<string> = [];\n</lobe-code></body></html>',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 4, rule: 'markup-in-text' });
    expect(issues[0].message).toContain('&lt;');
  });

  it('rejects invalid Mermaid at the line the parser points at', () => {
    const { issues } = runWithMermaid(
      '<html>\n<body>\n<lobe-mermaid>\nflowchart TD\n  A[Login --&gt; B\n</lobe-mermaid></body></html>',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'index.html', line: 6, rule: 'invalid-diagram' });
    expect(issues[0].message).toContain('Parse error on line 6');
  });

  it('rejects text that is not a diagram', () => {
    expect(
      runWithMermaid(page('<lobe-mermaid>just some words</lobe-mermaid>')).issues.map(
        (issue) => issue.rule,
      ),
    ).toEqual(['invalid-diagram']);
  });

  it('skips the Mermaid check when no checker is supplied', () => {
    expect(rules({ 'index.html': page('<lobe-mermaid>not a diagram</lobe-mermaid>') })).toEqual([]);
  });
});

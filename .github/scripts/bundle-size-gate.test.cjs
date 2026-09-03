const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { measureEntryGraph, stripHash } = require('./bundle-size-gate.cjs');

const writeDist = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-graph-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
};

test('walks static imports only and skips dynamic import()', () => {
  const root = writeDist({
    'index.html':
      '<script type="module" crossorigin src="/_spa/assets/index-AAAAAAAA.js"></script>',
    'assets/index-AAAAAAAA.js':
      'import{a}from"./sync-BBBBBBBB.js";import"../vendor/vendor-react-CCCCCCCC.js";const x=()=>import("./lazy-DDDDDDDD.js");export*from"./reexport-EEEEEEEE.js";',
    'assets/sync-BBBBBBBB.js': 'import{b}from"./sync-BBBBBBBB.js";export const a=1;',
    'assets/reexport-EEEEEEEE.js': 'export const r=1;',
    'assets/lazy-DDDDDDDD.js': 'export const lazy=1;',
    'vendor/vendor-react-CCCCCCCC.js': 'export const react=1;',
  });

  const graph = measureEntryGraph(root);

  assert.equal(graph.entry, 'assets/index-AAAAAAAA.js');
  assert.equal(graph.count, 4);
  assert.deepEqual(graph.chunks, {
    'assets/index.js': 1,
    'assets/reexport.js': 1,
    'assets/sync.js': 1,
    'vendor/vendor-react.js': 1,
  });
  assert.ok(graph.gz > 0);
});

test('stripHash removes the trailing rolldown hash including hashes starting with a dash', () => {
  assert.equal(
    stripHash('i18n/i18n-ja-JP-ui-runtime--Jre4geO.js'),
    'i18n/i18n-ja-JP-ui-runtime.js',
  );
  assert.equal(stripHash('assets/es-DBDe-NCK.js'), 'assets/es.js');
  assert.equal(stripHash('assets/index-CDFWou5k.js'), 'assets/index.js');
});

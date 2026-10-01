const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildHeadline,
  countJsFiles,
  diffResolvedDeps,
  measureEntryGraph,
  readResolvedDeps,
  stripHash,
} = require('./bundle-size-gate.cjs');

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

test('counts Vite-emitted JS files recursively', () => {
  const root = writeDist({
    'assets/index-AAAAAAAA.js': 'export const index = 1;',
    'assets/index-AAAAAAAA.js.map': '{}',
    'assets/lazy-BBBBBBBB.js': 'export const lazy = 1;',
    'vendor/vendor-react-CCCCCCCC.js': 'export const react = 1;',
  });

  assert.equal(countJsFiles(root), 3);
});

const { spawnSync } = require('node:child_process');

const runCheck = ({ baselineGraphCount, baselineJsTotal, currentGraphCount, currentJsTotal }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'size-gate-'));
  const graph = (count) => ({
    chunks: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`assets/chunk-${i}.js`, 1]),
    ),
    count,
    entry: 'assets/index.js',
    gz: count,
  });
  const write = (name, count) =>
    fs.writeFileSync(
      path.join(root, name),
      JSON.stringify({
        graphs: { 'dist/desktop': graph(count) },
        jsChunks: {
          targets: { 'dist/desktop': name === 'baseline.json' ? baselineJsTotal : currentJsTotal },
          total: name === 'baseline.json' ? baselineJsTotal : currentJsTotal,
        },
        sizes: { 'dist/desktop': count },
      }),
    );
  write('baseline.json', baselineGraphCount);
  write('current.json', currentGraphCount);

  const args = [
    path.join(__dirname, 'bundle-size-gate.cjs'),
    'check',
    '--current',
    path.join(root, 'current.json'),
    '--baseline',
    path.join(root, 'baseline.json'),
    '--js-chunk-percent',
    '5',
    '--label',
    'Web dist',
    '--report',
    path.join(root, 'report.md'),
  ];

  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const reportPath = path.join(root, 'report.md');
  return {
    ...result,
    report: fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '',
  };
};

test('Vite JS output file count over the baseline percentage limit fails the gate', () => {
  const result = runCheck({
    baselineGraphCount: 10,
    baselineJsTotal: 100,
    currentGraphCount: 10,
    currentJsTotal: 106,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Vite JS output file count increases by more than 5%/);
});

test('Vite JS output file count at the baseline percentage limit passes the gate', () => {
  const result = runCheck({
    baselineGraphCount: 10,
    baselineJsTotal: 100,
    currentGraphCount: 10,
    currentJsTotal: 105,
  });
  assert.equal(result.status, 0);
});

test('reachable graph count increase alone does not fail the gate', () => {
  const result = runCheck({
    baselineGraphCount: 10,
    baselineJsTotal: 100,
    currentGraphCount: 20,
    currentJsTotal: 100,
  });
  assert.equal(result.status, 0);
});

test('a passing gate states the entry count and the largest delta in the heading', () => {
  const result = runCheck({
    baselineGraphCount: 10,
    baselineJsTotal: 100,
    currentGraphCount: 20,
    currentJsTotal: 100,
  });

  assert.equal(result.status, 0);
  assert.ok(result.report.startsWith('### ✅ Web dist — 1 entry, largest Δ +0.0 KB (+100.00%)'));
});

test('a rising file count never reports itself as a byte delta', () => {
  const result = runCheck({
    baselineGraphCount: 10,
    baselineJsTotal: 100,
    currentGraphCount: 10,
    currentJsTotal: 105,
  });

  assert.equal(result.status, 0);
  // +5 files is a file count, not "+0.0 KB (+5.00%)" of gzip output
  assert.ok(result.report.startsWith('### ✅ Web dist — 1 entry, largest Δ 0.0 KB (0.00%)'));
});

test('buildHeadline formats bytes only, but still counts a file-count breach', () => {
  const byteEntry = { base: 1024, delta: 0, over: false, unit: 'bytes' };
  const fileEntry = { base: 100, delta: 5, over: false, unit: 'files' };

  assert.equal(buildHeadline([byteEntry, fileEntry]), '1 entry, largest Δ 0.0 KB (0.00%)');
  assert.equal(
    buildHeadline([byteEntry, { ...fileEntry, over: true }]),
    'exceeds the gate on 1 of 2 entries',
  );
});

test('a failing gate states how many entries are over it in the heading', () => {
  const result = runCheck({
    baselineGraphCount: 10,
    baselineJsTotal: 100,
    currentGraphCount: 10,
    currentJsTotal: 106,
  });

  assert.equal(result.status, 1);
  assert.ok(result.report.startsWith('### ❌ Web dist — exceeds the gate on 1 of 2 entries'));
});

test('buildHeadline stays empty when nothing was comparable', () => {
  assert.equal(buildHeadline([]), '');
  assert.equal(
    buildHeadline([{ base: 1024, delta: -512, over: false }]),
    '1 entry, largest Δ -0.5 KB (-50.00%)',
  );
});

test('readResolvedDeps turns pnpm virtual store entries into name@version and drops peer suffixes', () => {
  const store = writeDist({
    '@scope+pkg@1.2.3_react@19.0.0/x': '',
    'string_decoder@1.3.0/x': '',
    'string_decoder@1.1.1_abc/x': '',
    'lock.yaml': '',
    'node_modules/x': '',
  });

  assert.deepEqual(readResolvedDeps(store), [
    '@scope/pkg@1.2.3',
    'string_decoder@1.1.1',
    'string_decoder@1.3.0',
  ]);
});

test('diffResolvedDeps reports changed, added and removed package versions only', () => {
  const drift = diffResolvedDeps(
    ['a@1.0.0', 'b@1.0.0', 'b@2.0.0', 'gone@1.0.0', 'same@1.0.0'],
    ['a@1.1.0', 'b@1.0.0', 'new@0.1.0', 'same@1.0.0'],
  );

  assert.deepEqual(drift, [
    { after: '1.1.0', before: '1.0.0', name: 'a' },
    { after: '1.0.0', before: '1.0.0, 2.0.0', name: 'b' },
    { after: '', before: '1.0.0', name: 'gone' },
    { after: '0.1.0', before: '', name: 'new' },
  ]);
});

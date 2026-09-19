#!/usr/bin/env node
/**
 * Bundle size gate: measure build artifacts and compare PR sizes against a
 * baseline artifact uploaded by canary branch builds.
 *
 * Usage:
 *   node bundle-size-gate.js measure --type <web|asar|entry-graph> --out <file.json>
 *   node bundle-size-gate.js check --current <file.json> --baseline <file.json> [--label <name>] [--report <file.md>] [--percent <n>] [--floor <bytes>] [--js-chunk-percent <n>]
 *
 * Thresholds (env, overridable per check via --percent / --floor / --js-chunk-percent):
 *   SIZE_GATE_PERCENT           max allowed size increase in percent (default 3)
 *   SIZE_GATE_FLOOR_BYTES       min absolute size increase before failing (default 512 KiB)
 *   SIZE_GATE_JS_CHUNK_PERCENT  max allowed Vite JS output file count increase (default 5)
 *
 * An entry fails when: increase > max(baseline * percent / 100, floor).
 *
 * `entry-graph` measures the gzip size of every JS chunk reachable from the SPA
 * entry through *static* imports only (dynamic `import()` excluded). Total dist
 * size cannot see a lazy chunk being pulled back into the sync graph; this can.
 * It also records the total number of Vite-emitted `.js` files under the dist
 * targets and gates that total against the baseline with a separate percentage
 * threshold.
 * Missing baseline or missing current report degrades to a warning + exit 0,
 * so the gate never blocks before the first baseline exists.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const WEB_TARGETS = ['dist/desktop', 'dist/auth', 'dist/workbench'];
const ENTRY_GRAPH_TARGETS = [
  { dir: 'dist/desktop', html: 'index.html' },
  { dir: 'dist/mobile', html: 'index.mobile.html' },
  { dir: 'dist/auth', html: 'index.auth.html' },
];
const VITE_JS_TARGETS = [
  ...new Set([...WEB_TARGETS, ...ENTRY_GRAPH_TARGETS.map(({ dir }) => dir)]),
];
const STATIC_IMPORT_RE =
  /(?:^|[;{}\s)])(?:import(?:[\w$*{},\s]+from\s*)?|export\s*(?:\*|\{[^}]*\})\s*from\s*)["']([^"']+\.js)["']/g;
const ASAR_SEARCH_ROOT = 'apps/desktop/release';
const PNPM_STORE_DIR = 'node_modules/.pnpm';

const die = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      args._.push(arg);
    }
  }
  return args;
};

const dirSize = (dir) => {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
};

const countJsFiles = (dir) => {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countJsFiles(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) total += 1;
  }
  return total;
};

const measureViteJsChunks = () => {
  const targets = {};
  for (const target of VITE_JS_TARGETS) {
    if (!fs.existsSync(target)) continue;
    targets[target] = countJsFiles(target);
  }
  return {
    targets,
    total: Object.values(targets).reduce((sum, count) => sum + count, 0),
  };
};

/** Normalize runner os/arch so matrix naming differences (macos-latest vs macos-15) don't matter. */
const normalizedPlatform = () => {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (platform === 'win32') return 'windows-x64';
  return `linux-${arch}`;
};

/** Recursively find app.asar, skipping extracted `*.asar.unpacked` directories. */
const findAsar = (root) => {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.asar.unpacked')) continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name === 'app.asar') {
        return full;
      }
    }
  }
  return null;
};

const stripHash = (file) => file.replace(/-[\w-]{8}\.js$/, '.js');

const measureEntryGraph = (root, htmlFile = 'index.html') => {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const entryMatch = html.match(
    /<script[^>]*type="module"[^>]*src="[^"]*?\/((?:assets|vendor)\/[^"]+\.js)"/,
  );
  if (!entryMatch) die(`no module entry script found in ${root}/${htmlFile}`);
  const entry = entryMatch[1];

  const visited = new Set();
  let gz = 0;
  const walk = (rel) => {
    const abs = path.resolve(root, rel);
    if (visited.has(abs)) return;
    visited.add(abs);
    const src = fs.readFileSync(abs, 'utf8');
    gz += zlib.gzipSync(src).length;
    for (const match of src.matchAll(STATIC_IMPORT_RE))
      walk(path.join(path.dirname(rel), match[1]));
  };
  walk(entry);

  const chunks = {};
  for (const abs of visited) {
    const name = stripHash(path.relative(root, abs));
    chunks[name] = (chunks[name] || 0) + 1;
  }
  return { chunks, count: visited.size, entry, gz };
};

// pnpm-workspace.yaml sets `lockfile: false`, so the only record of what a build
// actually resolved is the virtual store directory: `<name>@<version>[_<peer-hash>]`.
const readResolvedDeps = (storeDir = PNPM_STORE_DIR) => {
  if (!fs.existsSync(storeDir)) return [];
  const deps = new Set();
  for (const entry of fs.readdirSync(storeDir)) {
    if (entry.startsWith('.') || entry === 'lock.yaml' || entry === 'node_modules') continue;
    const at = entry.indexOf('@', 1);
    if (at < 1) continue;
    const version = entry.slice(at + 1).split('_')[0];
    deps.add(`${entry.slice(0, at).replace('+', '/')}@${version}`);
  }
  return [...deps].sort();
};

const diffResolvedDeps = (baseline = [], current = []) => {
  const versionsOf = (list) => {
    const map = new Map();
    for (const dep of list) {
      const at = dep.lastIndexOf('@');
      const name = dep.slice(0, at);
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(dep.slice(at + 1));
    }
    return map;
  };
  const base = versionsOf(baseline);
  const cur = versionsOf(current);
  const drift = [];
  for (const name of new Set([...base.keys(), ...cur.keys()])) {
    const before = (base.get(name) || []).join(', ');
    const after = (cur.get(name) || []).join(', ');
    if (before !== after) drift.push({ after, before, name });
  }
  return drift.sort((a, b) => a.name.localeCompare(b.name));
};

const measure = (args) => {
  const { type, out } = args;
  if (!type || !out) die('measure requires --type <web|asar> and --out <file.json>');

  let result;
  if (type === 'web') {
    const sizes = {};
    for (const target of WEB_TARGETS) {
      if (!fs.existsSync(target)) {
        console.warn(`⚠️ ${target} not found, skipping`);
        continue;
      }
      sizes[target] = dirSize(target);
    }
    if (Object.keys(sizes).length === 0) die('no dist targets found — did the build run?');
    sizes.total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
    result = { resolvedDeps: readResolvedDeps(), sizes, type };
  } else if (type === 'entry-graph') {
    const sizes = {};
    const graphs = {};
    for (const { dir, html } of ENTRY_GRAPH_TARGETS) {
      if (!fs.existsSync(path.join(dir, html))) {
        console.warn(`⚠️ ${dir}/${html} not found, skipping`);
        continue;
      }
      const graph = measureEntryGraph(dir, html);
      sizes[dir] = graph.gz;
      graphs[dir] = graph;
      console.log(`   ${dir}: ${graph.count} chunks reachable from ${graph.entry}`);
    }
    if (Object.keys(sizes).length === 0) die('no dist targets found — did the build run?');
    const jsChunks = measureViteJsChunks();
    result = { graphs, jsChunks, sizes, type };
  } else if (type === 'asar') {
    const asarPath = findAsar(ASAR_SEARCH_ROOT);
    if (!asarPath) die(`app.asar not found under ${ASAR_SEARCH_ROOT}`);
    result = {
      path: asarPath,
      platform: normalizedPlatform(),
      sizes: { 'app.asar': fs.statSync(asarPath).size },
      type,
    };
  } else {
    die(`unknown --type "${type}" (expected web|asar|entry-graph)`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`📦 measured ${type} sizes -> ${out}`);
  for (const [key, size] of Object.entries(result.sizes)) {
    console.log(`   ${key}: ${humanSize(size)}`);
  }
  if (result.jsChunks) {
    console.log(`   vite js chunks: ${result.jsChunks.total}`);
  }
};

const humanSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const formatDelta = (delta, baseline) => {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const percent = baseline > 0 ? ` (${sign}${((delta / baseline) * 100).toFixed(2)}%)` : '';
  return `${sign}${humanSize(Math.abs(delta))}${percent}`;
};

const formatCountLimit = (count) => (Number.isInteger(count) ? String(count) : count.toFixed(2));

const appendReport = (file, section) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${section}\n\n`);
};

const check = (args) => {
  const { current, baseline, label = 'Bundle', report } = args;
  if (!current) die('check requires --current <file.json>');

  // Emit a visible "skipped" section so the PR comment / step summary explain
  // why the gate passed instead of falling back to a misleading placeholder.
  const skipWithNotice = (reason) => {
    const section = `### ⚠️ ${label}\n\n${reason}\n\n> Gate skipped — no failure is reported.`;
    console.warn(`\n${section}\n`);
    if (report) appendReport(report, section);
    if (process.env.GITHUB_STEP_SUMMARY) appendReport(process.env.GITHUB_STEP_SUMMARY, section);
  };

  if (!fs.existsSync(current)) {
    skipWithNotice(
      `Current size report \`${current}\` not found — the measure step did not produce it.`,
    );
    return;
  }
  const currentReport = JSON.parse(fs.readFileSync(current, 'utf8'));
  const currentSizes = currentReport.sizes || {};

  if (!baseline || !fs.existsSync(baseline)) {
    skipWithNotice(
      `No baseline found (\`${baseline || '(not provided)'}\`). This is expected on first rollout or after baseline artifacts expire — the gate activates once a canary build publishes a baseline.`,
    );
    return;
  }
  const baselineReport = JSON.parse(fs.readFileSync(baseline, 'utf8'));
  const baselineSizes = baselineReport.sizes || {};

  const percent = Number(args.percent || process.env.SIZE_GATE_PERCENT || 3);
  const floor = Number(args.floor || process.env.SIZE_GATE_FLOOR_BYTES || 512 * 1024);
  const jsChunkPercent = Number(
    args['js-chunk-percent'] || process.env.SIZE_GATE_JS_CHUNK_PERCENT || 5,
  );

  const keys = [...new Set([...Object.keys(baselineSizes), ...Object.keys(currentSizes)])];
  const rows = [];
  let failed = false;

  for (const key of keys) {
    const base = baselineSizes[key];
    const cur = currentSizes[key];
    if (base === undefined) {
      rows.push(`| ${key} | — | ${humanSize(cur)} | 🆕 new | ✅ |`);
      continue;
    }
    if (cur === undefined) {
      rows.push(`| ${key} | ${humanSize(base)} | — | removed | ✅ |`);
      continue;
    }
    const delta = cur - base;
    const limit = Math.max((base * percent) / 100, floor);
    const over = delta > limit;
    if (over) failed = true;
    rows.push(
      `| ${key} | ${humanSize(base)} | ${humanSize(cur)} | ${formatDelta(delta, base)} | ${over ? '❌' : '✅'} |`,
    );
  }

  const graphRows = [];
  if (currentReport.graphs) {
    for (const key of Object.keys(currentReport.graphs)) {
      const base = baselineReport.graphs?.[key];
      const cur = currentReport.graphs[key];
      const added = base ? Object.keys(cur.chunks).filter((name) => !base.chunks[name]) : [];
      const removed = base ? Object.keys(base.chunks).filter((name) => !cur.chunks[name]) : [];
      graphRows.push(
        `| ${key} | ${base?.count ?? '—'} | ${cur.count} | ${added.map((n) => `\`${n}\``).join(', ') || '—'} | ${removed.map((n) => `\`${n}\``).join(', ') || '—'} |`,
      );
    }
  }

  const jsChunkRows = [];
  const currentJsChunks = currentReport.jsChunks;
  if (currentJsChunks) {
    const baselineJsChunks = baselineReport.jsChunks;
    if (typeof baselineJsChunks?.total === 'number') {
      const chunkLimit = baselineJsChunks.total * (1 + jsChunkPercent / 100);
      const over = currentJsChunks.total > chunkLimit;
      if (over) failed = true;
      const targetKeys = [
        ...new Set([
          ...Object.keys(baselineJsChunks.targets || {}),
          ...Object.keys(currentJsChunks.targets || {}),
        ]),
      ];
      for (const key of targetKeys) {
        const base = baselineJsChunks.targets?.[key];
        const cur = currentJsChunks.targets?.[key];
        const delta = base !== undefined && cur !== undefined ? cur - base : null;
        jsChunkRows.push(
          `| ${key} | ${base ?? '—'} | ${cur ?? '—'} | ${delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta}`} | — | — |`,
        );
      }
      jsChunkRows.push(
        `| **Total** | **${baselineJsChunks.total}** | **${currentJsChunks.total}** | **${currentJsChunks.total >= baselineJsChunks.total ? '+' : ''}${currentJsChunks.total - baselineJsChunks.total}** | **+${jsChunkPercent}% (${formatCountLimit(chunkLimit)})** | **${over ? '❌' : '✅'}** |`,
      );
    } else {
      jsChunkRows.push(
        `| **Total** | **—** | **${currentJsChunks.total}** | **—** | **—** | **⚠️ baseline missing jsChunks** |`,
      );
    }
  }

  const drift =
    baselineReport.resolvedDeps && currentReport.resolvedDeps
      ? diffResolvedDeps(baselineReport.resolvedDeps, currentReport.resolvedDeps)
      : null;
  const driftRows = (drift || []).map(
    ({ name, before, after }) => `| ${name} | ${before || '—'} | ${after || '—'} |`,
  );

  const section = [
    `### ${failed ? '❌' : '✅'} ${label}`,
    '',
    `| Entry | Baseline | Current | Δ | Result |`,
    `| --- | --- | --- | --- | --- |`,
    ...rows,
    '',
    `> Gate: fails when increase > max(${percent}% of baseline, ${humanSize(floor)}). Baseline: latest canary build.`,
    ...(jsChunkRows.length > 0
      ? [
          '',
          `| Vite JS output | Baseline files | Current files | Δ | Limit | Result |`,
          `| --- | --- | --- | --- | --- | --- |`,
          ...jsChunkRows,
          '',
          `> Gate: fails when the total number of Vite-emitted JS files increases by more than ${jsChunkPercent}% from the canary baseline.`,
        ]
      : []),
    ...(graphRows.length > 0
      ? [
          '',
          `| Entry | Baseline reachable chunks | Current reachable chunks | Added to sync graph | Removed |`,
          `| --- | --- | --- | --- | --- |`,
          ...graphRows,
          '',
          `> Static graph chunk names are informational; the gate above uses the total Vite JS output file count.`,
        ]
      : []),
    ...(drift
      ? [
          '',
          `<details><summary>Resolved dependency drift vs baseline: ${drift.length} package(s)</summary>`,
          '',
          ...(drift.length > 0
            ? [`| Package | Baseline | Current |`, `| --- | --- | --- |`, ...driftRows]
            : ['No dependency version changed between the baseline install and this install.']),
          '',
          `> No lockfile is committed, so every install re-resolves. Size deltas with drift but no package.json change come from upstream releases, not this PR.`,
          '',
          '</details>',
        ]
      : []),
  ].join('\n');

  console.log(`\n${section}\n`);

  if (report) appendReport(report, section);
  if (process.env.GITHUB_STEP_SUMMARY) appendReport(process.env.GITHUB_STEP_SUMMARY, section);

  if (failed) {
    console.error(
      `❌ ${label} exceeds the gate: size increase > max(${percent}%, ${humanSize(floor)}) or Vite JS output file count increases by more than ${jsChunkPercent}% from baseline. ` +
        'Inspect the added dependencies or imports, or adjust SIZE_GATE_PERCENT / SIZE_GATE_FLOOR_BYTES / SIZE_GATE_JS_CHUNK_PERCENT if this is expected.',
    );
    if (drift?.length) {
      console.error(
        `⚠️ ${drift.length} resolved dependency version(s) differ from the baseline install; see the drift table before attributing the increase to this PR.`,
      );
    }
    process.exit(1);
  }
};

module.exports = {
  countJsFiles,
  diffResolvedDeps,
  measureEntryGraph,
  measureViteJsChunks,
  readResolvedDeps,
  stripHash,
};

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (command === 'measure') measure(args);
  else if (command === 'check') check(args);
  else die('usage: bundle-size-gate.js <measure|check> [--flags]');
}

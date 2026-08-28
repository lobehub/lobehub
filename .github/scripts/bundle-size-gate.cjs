#!/usr/bin/env node
/**
 * Bundle size gate: measure build artifacts and compare PR sizes against a
 * baseline artifact uploaded by canary branch builds.
 *
 * Usage:
 *   node bundle-size-gate.js measure --type <web|asar> --out <file.json>
 *   node bundle-size-gate.js check --current <file.json> --baseline <file.json> [--label <name>] [--report <file.md>]
 *
 * Thresholds (env):
 *   SIZE_GATE_PERCENT      max allowed increase in percent (default 3)
 *   SIZE_GATE_FLOOR_BYTES  min absolute increase before failing (default 512 KiB)
 *
 * An entry fails when: increase > max(baseline * percent / 100, floor).
 * Missing baseline or missing current report degrades to a warning + exit 0,
 * so the gate never blocks before the first baseline exists.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WEB_TARGETS = ['dist/desktop', 'dist/auth', 'dist/workbench'];
const ASAR_SEARCH_ROOT = 'apps/desktop/release';

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
    result = { sizes, type };
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
    die(`unknown --type "${type}" (expected web|asar)`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`📦 measured ${type} sizes -> ${out}`);
  for (const [key, size] of Object.entries(result.sizes)) {
    console.log(`   ${key}: ${humanSize(size)}`);
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
  const currentSizes = JSON.parse(fs.readFileSync(current, 'utf8')).sizes || {};

  if (!baseline || !fs.existsSync(baseline)) {
    skipWithNotice(
      `No baseline found (\`${baseline || '(not provided)'}\`). This is expected on first rollout or after baseline artifacts expire — the gate activates once a canary build publishes a baseline.`,
    );
    return;
  }
  const baselineSizes = JSON.parse(fs.readFileSync(baseline, 'utf8')).sizes || {};

  const percent = Number(process.env.SIZE_GATE_PERCENT || 3);
  const floor = Number(process.env.SIZE_GATE_FLOOR_BYTES || 512 * 1024);

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

  const section = [
    `### ${failed ? '❌' : '✅'} ${label}`,
    '',
    `| Entry | Baseline | Current | Δ | Result |`,
    `| --- | --- | --- | --- | --- |`,
    ...rows,
    '',
    `> Gate: fails when increase > max(${percent}% of baseline, ${humanSize(floor)}). Baseline: latest canary build.`,
  ].join('\n');

  console.log(`\n${section}\n`);

  if (report) appendReport(report, section);
  if (process.env.GITHUB_STEP_SUMMARY) appendReport(process.env.GITHUB_STEP_SUMMARY, section);

  if (failed) {
    console.error(
      `❌ ${label} size increase exceeds the gate threshold (+${percent}% / +${humanSize(floor)}). ` +
        'Inspect the added dependencies or assets, or adjust SIZE_GATE_PERCENT / SIZE_GATE_FLOOR_BYTES if this is expected.',
    );
    process.exit(1);
  }
};

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (command === 'measure') measure(args);
else if (command === 'check') check(args);
else die('usage: bundle-size-gate.js <measure|check> [--flags]');

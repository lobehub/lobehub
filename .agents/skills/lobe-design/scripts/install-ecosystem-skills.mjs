#!/usr/bin/env node
// lobe-design — install / update docs skills for @lobehub/* packages used by a project.
// Zero deps. Node >= 18 (fetch).
//
// Usage:
//   node scripts/install-ecosystem-skills.mjs [--root <dir>] [--check] [--dry-run] [--force] [--json] [--list]
//
// Scans package.json (root + pnpm/npm/yarn workspaces when present) for mapped @lobehub/*
// dependencies, fetches each package's public skills.md, and writes:
//   <root>/.agents/skills/<skillName>/SKILL.md
// Metadata (etag/hash/url) lives in:
//   <root>/.agents/skills/.lobe-ecosystem-skills.json
//
// Idempotent: re-runs skip unchanged skills (etag / sha256). --force re-downloads.
// Packages marked status=missing in the map are skipped with a warning (never fake-OK).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(HERE, 'ecosystem-skills.json');
const SKILLS_DIR = '.agents/skills';
const META_NAME = '.lobe-ecosystem-skills.json';
const USER_AGENT = 'lobe-design-install-ecosystem-skills/1.0 (+https://github.com/lobehub/lobe-design-skill)';

function loadMap() {
  const raw = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
  return raw.packages || {};
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Collect dependency names from one package.json (deps + optional + peer + dev). */
function depsFromPkg(pkg) {
  const out = new Set();
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const block = pkg?.[key];
    if (!block || typeof block !== 'object') continue;
    for (const name of Object.keys(block)) out.add(name);
  }
  return out;
}

/** Resolve workspace package.json paths (pnpm / npm / yarn / lerna-ish). */
function workspacePackageJsons(root, rootPkg) {
  const found = [join(root, 'package.json')];
  const patterns = [];
  if (Array.isArray(rootPkg?.workspaces)) patterns.push(...rootPkg.workspaces);
  else if (Array.isArray(rootPkg?.workspaces?.packages)) patterns.push(...rootPkg.workspaces.packages);
  const pnpm = readJsonSafe(join(root, 'pnpm-workspace.yaml'));
  // pnpm-workspace.yaml is YAML — lightweight glob collect without a YAML parser:
  // also walk common package dirs when workspace file exists or workspaces field set.
  const candidates = new Set();
  if (existsSync(join(root, 'pnpm-workspace.yaml')) || patterns.length) {
    for (const dir of ['packages', 'apps', 'sites', 'site', 'examples', 'modules']) {
      const abs = join(root, dir);
      if (!existsSync(abs)) continue;
      for (const ent of readdirSync(abs, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const pj = join(abs, ent.name, 'package.json');
        if (existsSync(pj)) candidates.add(pj);
      }
    }
  }
  // Explicit simple globs like "packages/*" already covered by walk above.
  // Also include nested package.json listed via workspaces if they are plain paths.
  for (const p of patterns) {
    if (p.includes('*') || p.includes('{')) continue;
    const pj = join(root, p, 'package.json');
    if (existsSync(pj)) candidates.add(pj);
  }
  found.push(...candidates);
  return [...new Set(found)].filter((p) => existsSync(p));
}

/** Return Map packageName → { version?, sources[] } for @lobehub/* hits. */
function scanLobePackages(root) {
  const rootPkgPath = join(root, 'package.json');
  if (!existsSync(rootPkgPath)) return { packages: new Map(), packageJsons: [], error: 'no package.json' };
  const rootPkg = readJsonSafe(rootPkgPath) || {};
  const files = workspacePackageJsons(root, rootPkg);
  const packages = new Map();
  for (const file of files) {
    const pkg = readJsonSafe(file);
    if (!pkg) continue;
    const rel = file.slice(root.length).replace(/^[\\/]/, '') || 'package.json';
    for (const name of depsFromPkg(pkg)) {
      if (!name.startsWith('@lobehub/')) continue;
      const version =
        pkg.dependencies?.[name] ||
        pkg.devDependencies?.[name] ||
        pkg.optionalDependencies?.[name] ||
        pkg.peerDependencies?.[name] ||
        null;
      const prev = packages.get(name) || { version: null, sources: [] };
      if (!prev.version && version) prev.version = version;
      prev.sources.push(rel);
      packages.set(name, prev);
    }
  }
  return { packages, packageJsons: files, error: null };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function fetchSkills(url, { etag } = {}) {
  const headers = { 'user-agent': USER_AGENT, accept: 'text/markdown, text/plain, */*' };
  if (etag) headers['if-none-match'] = etag;
  const res = await fetch(url, { headers, redirect: 'follow' });
  const newEtag = res.headers.get('etag');
  if (res.status === 304) {
    return { status: 304, etag: newEtag || etag, body: null, notModified: true };
  }
  const body = await res.text();
  return { status: res.status, etag: newEtag, body, notModified: false };
}

function loadMeta(root) {
  const path = join(root, SKILLS_DIR, META_NAME);
  if (!existsSync(path)) return { version: 1, skills: {} };
  return readJsonSafe(path) || { version: 1, skills: {} };
}

function saveMeta(root, meta) {
  const dir = join(root, SKILLS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, META_NAME), `${JSON.stringify(meta, null, 2)}\n`);
}

function parseFrontmatterName(body) {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const name = m[1].match(/^name:\s*(\S+)/m);
  return name?.[1] ?? null;
}

/**
 * Install one skill URL into .agents/skills/<skill>/SKILL.md.
 * Returns a result object.
 */
async function installOne(root, { pkg, entry, force, dryRun, meta }) {
  const skill = entry.skill;
  const url = entry.url;
  const destDir = join(root, SKILLS_DIR, skill);
  const destFile = join(destDir, 'SKILL.md');
  const prev = meta.skills?.[skill] || {};
  const existed = existsSync(destFile);

  if (entry.status === 'missing') {
    return {
      pkg,
      skill: skill || null,
      url: url || null,
      action: 'skipped-missing',
      ok: false,
      warn: entry.note || 'skills entry missing in map',
    };
  }

  if (!url || !skill) {
    return { pkg, skill: skill || null, url: url || null, action: 'skipped-missing', ok: false, warn: 'map entry incomplete' };
  }

  let fetchResult;
  try {
    fetchResult = await fetchSkills(url, { etag: force ? undefined : prev.etag });
  } catch (err) {
    return { pkg, skill, url, action: 'error', ok: false, error: String(err?.message || err) };
  }

  if (fetchResult.notModified && existed && !force) {
    return { pkg, skill, url, action: 'unchanged', ok: true, etag: fetchResult.etag, hash: prev.hash };
  }

  if (fetchResult.status !== 200 || fetchResult.body == null) {
    return {
      pkg,
      skill,
      url,
      action: 'error',
      ok: false,
      error: `HTTP ${fetchResult.status} fetching ${url}`,
    };
  }

  const body = fetchResult.body;
  const hash = sha256(body);
  if (!force && existed && prev.hash === hash && prev.url === url) {
    // Content same even if etag missing/changed
    meta.skills[skill] = {
      ...prev,
      url,
      hash,
      etag: fetchResult.etag || prev.etag || null,
      packages: [...new Set([...(prev.packages || []), pkg])],
      updatedAt: prev.updatedAt || new Date().toISOString(),
    };
    return { pkg, skill, url, action: 'unchanged', ok: true, etag: fetchResult.etag, hash };
  }

  const fmName = parseFrontmatterName(body);
  if (dryRun) {
    return {
      pkg,
      skill,
      url,
      action: existed ? 'would-update' : 'would-install',
      ok: true,
      hash,
      etag: fetchResult.etag,
      frontmatterName: fmName,
    };
  }

  mkdirSync(destDir, { recursive: true });
  writeFileSync(destFile, body.endsWith('\n') ? body : `${body}\n`);
  meta.skills[skill] = {
    url,
    hash,
    etag: fetchResult.etag || null,
    packages: [...new Set([...(prev.packages || []), pkg])],
    frontmatterName: fmName,
    updatedAt: new Date().toISOString(),
  };
  return {
    pkg,
    skill,
    url,
    action: existed ? 'updated' : 'installed',
    ok: true,
    hash,
    etag: fetchResult.etag,
    frontmatterName: fmName,
    dest: join(SKILLS_DIR, skill, 'SKILL.md'),
  };
}

function printHelp() {
  console.log(`lobe-design install-ecosystem-skills — 按项目依赖安装 @lobehub/* 的 docs skills.md

用法
  node scripts/install-ecosystem-skills.mjs                 扫描并安装/更新
  node scripts/install-ecosystem-skills.mjs --root <dir>    指定项目根（默认 cwd）
  node scripts/install-ecosystem-skills.mjs --check         只报告，不写盘；有可更新或缺失映射 → exit 1
  node scripts/install-ecosystem-skills.mjs --dry-run       拉取并比对，不写盘
  node scripts/install-ecosystem-skills.mjs --force         忽略 etag/hash，强制重装
  node scripts/install-ecosystem-skills.mjs --list          打印映射表与扫描命中，不联网
  node scripts/install-ecosystem-skills.mjs --json          JSON 输出

安装位置
  <root>/.agents/skills/<skill>/SKILL.md
  元数据：<root>/.agents/skills/.lobe-ecosystem-skills.json

映射表
  scripts/ecosystem-skills.json（包名 → url / skill / status）
  status=missing 的包会告警并跳过，不会假装成功。`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const root = args.includes('--root') ? resolve(args[args.indexOf('--root') + 1]) : process.cwd();
  const json = args.includes('--json');
  const check = args.includes('--check');
  const dryRun = args.includes('--dry-run') || check;
  const force = args.includes('--force');
  const listOnly = args.includes('--list');

  if (!existsSync(root)) {
    console.error(`用法错误：目录不存在：${root}`);
    process.exit(2);
  }

  const map = loadMap();
  const scan = scanLobePackages(root);
  const hits = [...scan.packages.keys()].sort();
  const mappedHits = hits.filter((n) => map[n]);
  const unmappedHits = hits.filter((n) => !map[n]);

  // Deduplicate by skill name: multiple packages may share one skill (lint configs → lobe-lint)
  const skillJobs = new Map(); // skill → { entry, pkgs: [] }
  const missingPkgs = [];
  for (const pkg of mappedHits) {
    const entry = map[pkg];
    if (entry.status === 'missing') {
      missingPkgs.push({ pkg, note: entry.note || 'missing' });
      continue;
    }
    const key = entry.skill || pkg;
    const job = skillJobs.get(key) || { entry, pkgs: [] };
    job.pkgs.push(pkg);
    skillJobs.set(key, job);
  }

  if (listOnly) {
    const out = {
      root,
      mapPath: MAP_PATH,
      mapCount: Object.keys(map).length,
      scannedPackageJsons: scan.packageJsons.map((p) => p.slice(root.length).replace(/^[\\/]/, '') || 'package.json'),
      hits: Object.fromEntries([...scan.packages.entries()].map(([k, v]) => [k, v])),
      unmappedHits,
      missingPkgs,
      skillsToInstall: [...skillJobs.entries()].map(([skill, j]) => ({
        skill,
        url: j.entry.url,
        packages: j.pkgs,
      })),
    };
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`root: ${root}`);
      console.log(`map:  ${Object.keys(map).length} packages`);
      console.log(`hits: ${hits.length ? hits.join(', ') : '(none)'}`);
      if (unmappedHits.length) console.log(`unmapped @lobehub/*: ${unmappedHits.join(', ')}`);
      if (missingPkgs.length) console.log(`mapped-missing: ${missingPkgs.map((m) => m.pkg).join(', ')}`);
      for (const [skill, j] of skillJobs) {
        console.log(`  → ${skill}  ${j.entry.url}  (${j.pkgs.join(', ')})`);
      }
    }
    process.exit(0);
  }

  if (scan.error) {
    const msg = `跳过：${scan.error}（${root}）`;
    if (json) console.log(JSON.stringify({ root, ok: true, skipped: true, reason: scan.error, results: [] }, null, 2));
    else console.log(msg);
    process.exit(0);
  }

  const meta = loadMeta(root);
  const results = [];

  for (const [skill, job] of skillJobs) {
    // Use first package name as primary label; still record all pkgs in meta via loop
    const primary = job.pkgs[0];
    const r = await installOne(root, {
      pkg: primary,
      entry: job.entry,
      force,
      dryRun,
      meta,
    });
    r.packages = job.pkgs;
    // Merge all packages into meta after successful write path
    if (!dryRun && r.ok && meta.skills[skill]) {
      meta.skills[skill].packages = [...new Set([...(meta.skills[skill].packages || []), ...job.pkgs])];
    }
    results.push(r);
  }

  for (const m of missingPkgs) {
    results.push({
      pkg: m.pkg,
      skill: null,
      url: null,
      action: 'skipped-missing',
      ok: false,
      warn: m.note,
      packages: [m.pkg],
    });
  }

  for (const name of unmappedHits) {
    results.push({
      pkg: name,
      skill: null,
      url: null,
      action: 'skipped-unmapped',
      ok: false,
      warn: 'not in ecosystem-skills.json — add a mapping or mark status=missing',
      packages: [name],
    });
  }

  if (!dryRun) saveMeta(root, meta);

  const installed = results.filter((r) => r.action === 'installed' || r.action === 'would-install');
  const updated = results.filter((r) => r.action === 'updated' || r.action === 'would-update');
  const unchanged = results.filter((r) => r.action === 'unchanged');
  const skipped = results.filter((r) => String(r.action).startsWith('skipped'));
  const errors = results.filter((r) => r.action === 'error');

  // --check: fail if updates available, errors, or missing/unmapped hits present
  const needsUpdate = results.some((r) => r.action === 'would-install' || r.action === 'would-update');
  // missing/unmapped stay warnings (map policy); --check fails only when installable skills are stale or fetch errored.
  const checkFail = check && (needsUpdate || errors.length > 0);

  const summary = {
    root,
    mode: check ? 'check' : dryRun ? 'dry-run' : force ? 'force' : 'install',
    hits,
    results,
    counts: {
      installed: installed.length,
      updated: updated.length,
      unchanged: unchanged.length,
      skipped: skipped.length,
      errors: errors.length,
    },
    ok: errors.length === 0 && (!check || !checkFail),
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`lobe-design ecosystem skills @ ${root}`);
    if (!hits.length) console.log('未发现 @lobehub/* 依赖。');
    for (const r of results) {
      const pkgs = (r.packages || [r.pkg]).join(', ');
      if (r.action === 'installed' || r.action === 'would-install') {
        console.log(`  + ${r.skill}  ← ${pkgs}\n    ${r.url}${r.dest ? `\n    → ${r.dest}` : ''}`);
      } else if (r.action === 'updated' || r.action === 'would-update') {
        console.log(`  ↑ ${r.skill}  ← ${pkgs}\n    ${r.url}`);
      } else if (r.action === 'unchanged') {
        console.log(`  = ${r.skill}  (up to date)`);
      } else if (r.action === 'skipped-missing') {
        console.log(`  ! ${pkgs}  missing skills — ${r.warn}`);
      } else if (r.action === 'skipped-unmapped') {
        console.log(`  ? ${pkgs}  unmapped — ${r.warn}`);
      } else if (r.action === 'error') {
        console.error(`  x ${r.skill || pkgs}  ${r.error}`);
      }
    }
    const { counts } = summary;
    console.log(
      `合计：install ${counts.installed} · update ${counts.updated} · unchanged ${counts.unchanged} · skipped ${counts.skipped} · error ${counts.errors}`,
    );
    if (check && checkFail) {
      console.error('--check：存在待安装/更新的生态 skills，或拉取失败。运行不带 --check 的命令修复。');
    }
  }

  if (errors.length) process.exit(1);
  if (checkFail) process.exit(1);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { loadMap, scanLobePackages, installOne, SKILLS_DIR, META_NAME };

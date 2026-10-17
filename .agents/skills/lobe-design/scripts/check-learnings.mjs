#!/usr/bin/env node
// lobe-design self-evolution gate. Zero dependencies.
// Validates the structured learnings log and keeps rules, regressions and versions in lock-step.
// Usage: node scripts/check-learnings.mjs [--log <file>] [--json] [--new]   (see --help)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './lint-lobe.mjs';
import { CHECKS } from './check-detail.mjs';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYERS = ['structure', 'lint', 'rule', 'style'];
const RANK = { structure: 4, lint: 3, rule: 2, style: 1 };
const SOURCES = ['user-correction', 'review', 'system-scan'];
const STATUSES = ['open', 'landed', 'rejected'];
const REQUIRED = ['id', 'date', 'status', 'symptom', 'source', 'scenario', 'stage', 'occurrences', 'root_cause', 'layer', 'layer_reason', 'artifacts', 'regression'];

const HELP = `lobe-design check-learnings — 自进化闸门（零依赖）

检查三件事：
  1. 经验日志（learnings/LOG.md 里的 \`\`\`learning 块）字段完整、取值合法
  2. 回写约束：
     L-01 同一现象 occurrences ≥ 2 时 layer 不能是 style（必须升级）
     L-02 layer=lint → artifacts 里的规则 id 必须存在于 lint-lobe / check-detail，且 regression 指向的 fixture 真的有 expect
     L-03 layer=rule → artifacts 里的规则编号必须在 references/ 中有定义
     L-04 status=landed 必须带 version，且 CHANGELOG 有该版本
     L-05 layer=style 必须写 why_not_code（为什么不能写成代码）
  3. 规则 ↔ 回归 ↔ 版本 一致：
     V-01 SKILL.md / pipeline.json / CHANGELOG 顶部版本一致
     V-02 每条 lint / detail 规则都至少有一个回归样例（fixture 中的 expect / expect-file）
     V-03 每条 lint 规则的 since 版本在 CHANGELOG 中出现，且 since ≠ 2.0.0 的规则 id 被该版本条目点名

用法
  node scripts/check-learnings.mjs                 检查 skill 自带的 learnings/LOG.md
  node scripts/check-learnings.mjs --log <file>    检查指定日志文件（目标路径参数）
  node scripts/check-learnings.mjs --new           打印一条带下一个 id 的空白条目模板
  --json                                           JSON 输出

退出码：0 全部通过 · 1 有 FAIL · 2 用法错误`;

const read = (p) => readFileSync(join(skillDir, p), 'utf8');
const semver = (v) => v.split('.').map(Number);
const cmp = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

export function parseLog(text) {
  const entries = [];
  for (const m of text.matchAll(/```learning\n([\s\S]*?)```/g)) {
    const e = { _line: text.slice(0, m.index).split('\n').length };
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/);
      if (kv) e[kv[1]] = kv[2].trim();
    }
    entries.push(e);
  }
  return entries;
}

function definedRefIds() {
  const ids = new Set();
  for (const f of readdirSync(join(skillDir, 'references'))) {
    const t = read(`references/${f}`);
    for (const m of t.matchAll(/^#{2,3}\s+([A-Z]-\d{1,2})\b/gm)) ids.add(m[1]);
    for (const m of t.matchAll(/^\|\s*([A-Z]-\d{1,2}\.\d+)\s*\|/gm)) ids.add(m[1]);
  }
  return ids;
}

function fixtureExpectations() {
  const map = new Map(); // id -> [file:line]
  const dir = join(skillDir, 'tests/fixtures');
  for (const f of readdirSync(dir)) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/expect(?:-file)?:\s*([A-Z0-9\- ]+)/);
      if (m) for (const id of m[1].trim().split(/\s+/)) (map.get(id) ?? map.set(id, []).get(id)).push(`tests/fixtures/${f}:${i + 1}`);
    });
  }
  return map;
}

export function checkLearnings({ log } = {}) {
  const out = [];
  const pass = (id, msg) => out.push({ level: 'PASS', id, msg });
  const fail = (id, msg) => out.push({ level: 'FAIL', id, msg });

  // ---- versions
  const skillV = read('SKILL.md').match(/^version:\s*(\S+)/m)?.[1];
  const pipeV = JSON.parse(read('scripts/pipeline.json')).version;
  const changelog = read('CHANGELOG.md');
  const clVersions = [...changelog.matchAll(/^##\s+(\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);
  const section = (v) => { const s = changelog.indexOf(`## ${v}`); if (s < 0) return ''; const n = changelog.indexOf('\n## ', s + 1); return changelog.slice(s, n < 0 ? undefined : n); };
  skillV === pipeV && pipeV === clVersions[0]
    ? pass('V-01', `版本一致：SKILL.md = pipeline.json = CHANGELOG 顶部 = ${skillV}`)
    : fail('V-01', `版本不一致：SKILL.md ${skillV} · pipeline.json ${pipeV} · CHANGELOG ${clVersions[0]}`);

  // ---- rule ↔ regression
  const expects = fixtureExpectations();
  const allRules = [...RULES.map((r) => r.id), ...CHECKS.map((c) => c.id)];
  const uncovered = allRules.filter((id) => !expects.has(id));
  uncovered.length ? fail('V-02', `没有回归样例的规则：${uncovered.join(', ')}`) : pass('V-02', `${allRules.length} 条确定性规则都有回归样例（lint ${RULES.length} + detail ${CHECKS.length}）`);

  // ---- rule ↔ changelog
  const badSince = RULES.filter((r) => !clVersions.includes(r.since) || cmp(r.since, skillV) > 0 || (r.since !== '2.0.0' && !section(r.since).includes(r.id)));
  badSince.length ? fail('V-03', `since 版本未在 CHANGELOG 登记或未点名：${badSince.map((r) => `${r.id}@${r.since}`).join(', ')}`)
    : pass('V-03', `每条 lint 规则的 since 都能在 CHANGELOG 找到（${[...new Set(RULES.map((r) => r.since))].join(', ')}）`);

  // ---- log entries
  const logPath = log ?? join(skillDir, 'learnings/LOG.md');
  const entries = parseLog(readFileSync(logPath, 'utf8'));
  entries.length ? pass('log-parse', `${logPath.replace(skillDir + '/', '')}：解析到 ${entries.length} 条经验`) : fail('log-parse', `${logPath} 中没有 \`\`\`learning 条目`);
  const refIds = definedRefIds();
  const seen = new Set();
  for (const e of entries) {
    const tag = `${e.id ?? '?'}（第 ${e._line} 行）`;
    const errs = [];
    const miss = REQUIRED.filter((k) => !e[k]);
    if (miss.length) errs.push(`缺字段 ${miss.join(', ')}`);
    if (e.id && !/^LRN-\d{8}-\d{2}$/.test(e.id)) errs.push(`id 格式应为 LRN-YYYYMMDD-NN`);
    if (e.id && seen.has(e.id)) errs.push('id 重复'); seen.add(e.id);
    if (e.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errs.push('date 格式应为 YYYY-MM-DD');
    if (e.status && !STATUSES.includes(e.status)) errs.push(`status 只能是 ${STATUSES.join('|')}`);
    if (e.source && !SOURCES.includes(e.source)) errs.push(`source 只能是 ${SOURCES.join('|')}`);
    if (e.layer && !LAYERS.includes(e.layer)) errs.push(`layer 只能是 ${LAYERS.join('|')}`);
    const occ = Number(e.occurrences);
    if (e.occurrences && !(occ >= 1)) errs.push('occurrences 必须是 ≥ 1 的整数');
    // L-01 escalate on repeat
    if (occ >= 2 && e.layer && RANK[e.layer] <= RANK.style) errs.push('L-01 同一现象出现 ≥ 2 次，layer 不能停在 style，必须升级到 rule / lint / structure');
    if (e.previous_layer && LAYERS.includes(e.previous_layer) && RANK[e.layer] <= RANK[e.previous_layer]) errs.push(`L-01 复发条目必须比上次（${e.previous_layer}）更强`);
    const arts = (e.artifacts ?? '').split(/[,\s]+/).filter(Boolean);
    // L-02 lint layer must point to a real rule + real regression
    if (e.layer === 'lint' && e.status === 'landed') {
      const ruleIds = arts.filter((a) => /^(LOBE|DETAIL)-[A-Z0-9-]+$/.test(a));
      if (!ruleIds.length) errs.push('L-02 layer=lint 但 artifacts 里没有 LOBE-* / DETAIL-* 规则 id');
      for (const id of ruleIds) if (!allRules.includes(id)) errs.push(`L-02 规则 ${id} 不存在于 lint-lobe / check-detail`);
      const reg = e.regression ?? '';
      const fx = reg.match(/(tests\/fixtures\/[\w.-]+)/)?.[1];
      if (!fx || !existsSync(join(skillDir, fx))) errs.push(`L-02 regression 必须指向存在的 tests/fixtures/* 文件（当前：${reg || '空'}）`);
      else for (const id of ruleIds) if (!(expects.get(id) ?? []).some((p) => p.startsWith(fx))) errs.push(`L-02 ${fx} 中没有 expect: ${id}`);
    }
    // L-03 rule layer must cite defined reference ids
    if (e.layer === 'rule' && e.status === 'landed') {
      const ids = arts.filter((a) => /^[A-Z]-\d{1,2}(\.\d+)?$/.test(a));
      if (!ids.length) errs.push('L-03 layer=rule 但 artifacts 里没有 references 规则编号（如 A-04.3）');
      for (const id of ids) if (!refIds.has(id) && !refIds.has(id.split('.')[0])) errs.push(`L-03 规则编号 ${id} 在 references/ 中没有定义`);
    }
    // L-04 versioned landing
    if (e.status === 'landed') {
      if (!e.version) errs.push('L-04 landed 条目必须写 version');
      else if (!clVersions.includes(e.version)) errs.push(`L-04 version ${e.version} 不在 CHANGELOG 中`);
    }
    // L-05 style needs justification
    if (e.layer === 'style' && !e.why_not_code) errs.push('L-05 layer=style 必须写 why_not_code');
    errs.length ? fail(`entry:${e.id ?? e._line}`, `${tag} ${errs.join('；')}`) : pass(`entry:${e.id}`, `${tag} ${e.layer} · ${e.status} · v${e.version ?? '—'}`);
  }
  return { results: out, entries };
}

function nextTemplate() {
  const today = new Date().toISOString().slice(0, 10);
  const ids = parseLog(read('learnings/LOG.md')).map((e) => e.id).filter((id) => id?.includes(today.replace(/-/g, '')));
  const n = String(ids.length + 1).padStart(2, '0');
  return ['```learning', `id: LRN-${today.replace(/-/g, '')}-${n}`, `date: ${today}`, 'status: open', 'symptom: ', 'source: user-correction', 'scenario: ', 'stage: ',
    'occurrences: 1', 'previous_layer: ', 'root_cause: ', 'layer: ', 'layer_reason: ', 'why_not_code: ', 'artifacts: ', 'regression: ', 'version: ', '```'].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(HELP); process.exit(0); }
  if (args.includes('--new')) { console.log(nextTemplate()); process.exit(0); }
  const log = args.includes('--log') ? args[args.indexOf('--log') + 1] : undefined;
  if (args.includes('--log') && (!log || !existsSync(log))) { console.error(`用法错误：--log 路径不存在：${log ?? '(空)'}\n\n${HELP}`); process.exit(2); }
  const { results } = checkLearnings({ log });
  const f = results.filter((r) => r.level === 'FAIL');
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else {
    console.log('LOBE-DESIGN · LEARNINGS');
    for (const r of results) console.log(`${r.level} ${r.id.padEnd(26)} ${r.msg}`);
    console.log(`RESULT: ${results.length - f.length} PASS, ${f.length} FAIL`);
  }
  process.exitCode = f.length ? 1 : 0;
}

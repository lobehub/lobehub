#!/usr/bin/env node
// lobe-design 消费方回流。零依赖。
// Usage: node scripts/upstream.mjs [--from learnings/LOG.md] [--json] [--write <file>]
//
// 从消费方的 learnings 日志里挑出「通用、无强品牌印记、非小众场景」的条目，
// 生成可以直接提给上游仓库的候选清单。判据是机械的：
//   1. landed 且带 version（半成品不回流）
//   2. 层在前三层（structure / lint / rule）—— style 层的结论依赖品味，不适合通用化
//   3. 文本里不出现项目专有名词（品牌印记检查）
//   4. 规则 id 是通用的 LOBE-* / DETAIL-* / 字母编号，不是本项目自定义的
//   5. 不是组件问题（组件 bug / 缺陷 / 默认值的绕法归 lobe-ui）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 会被上游视为「有品牌印记」的词（项目名 / 内部代号）。可用 --deny 追加。
const DEFAULT_DENY = ['lobehub-admin-enterprise', 'lobe-ops', 'lobe-admin', 'develop-center', '内部', '内网', '公司名'];

const LAYERS_OK = new Set(['structure', 'lint', 'rule']);

// 组件问题：组件修好之后就不成立的条目，归 lobe-ui，不进 skill。
const COMPONENT_BUG = /组件\s*(?:bug|缺陷|问题)|component[\s-]*bug|归\s*lobe-ui/i;

export function parseLog(text) {
  const out = [];
  for (const m of text.matchAll(/```learning\n([\s\S]*?)```/g)) {
    const e = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/);
      if (kv) e[kv[1]] = kv[2].trim();
    }
    out.push(e);
  }
  return out;
}

/** 对单条 learning 做通用性判定，返回 {ok, reasons[]}。 */
export function assess(entry, deny = DEFAULT_DENY) {
  const reasons = [];
  const blob = Object.values(entry).join(' ');
  if (entry.status !== 'landed') reasons.push(`status=${entry.status ?? '缺'}（只回流 landed）`);
  if (entry.status === 'landed' && !entry.version) reasons.push('landed 但没有 version');
  if (entry.layer && !LAYERS_OK.has(entry.layer)) reasons.push(`layer=${entry.layer}（style 层依赖品味，不通用化）`);
  if (Number(entry.occurrences) < 2) reasons.push('occurrences < 2（只出现一次，还不足以成为通用规则）');
  for (const word of deny) if (blob.toLowerCase().includes(word.toLowerCase())) reasons.push(`含品牌 / 项目印记：「${word}」`);
  if (!entry.symptom || !entry.root_cause) reasons.push('缺 symptom 或 root_cause（说不清问题就说不清判据）');
  if (!entry.artifacts) reasons.push('缺 artifacts');
  if (entry.scope === 'component-bug' || COMPONENT_BUG.test(`${entry.root_cause ?? ''} ${entry.layer_reason ?? ''}`)) reasons.push('组件问题（组件 bug / 缺陷 / 默认值的绕法归 lobe-ui，不回流）');
  return { ok: reasons.length === 0, reasons };
}

const HELP = `lobe-design upstream — 消费方通用经验回流（零依赖）

用法
  node scripts/upstream.mjs                        检查默认 learnings/LOG.md，列出候选
  node scripts/upstream.mjs --from <file>          指定日志
  node scripts/upstream.mjs --write <file>         把候选清单写成可直接提 PR 的 markdown
  node scripts/upstream.mjs --deny "词1,词2"        追加品牌 / 项目印记检查词
  --json                                           JSON 输出

回流判据（缺一不可）
  1. landed 且带 version
  2. layer ∈ {structure, lint, rule}（style 层不回流）
  3. occurrences ≥ 2（至少复发过一次才说明是通用问题）
  4. 不含品牌 / 项目专有名词
  5. symptom、root_cause、artifacts 齐全
  6. 不是组件问题（scope: component-bug 或根因写明组件 bug，归 lobe-ui）

退出码：0 有候选 · 1 没有候选 · 2 用法错误`;

function toMarkdown(candidates, file) {
  const lines = [
    '# 上游回流候选',
    '',
    `来源：\`${file}\`　生成：\`node scripts/upstream.mjs\``,
    '',
    '这些条目已通过通用性自检（与项目无关、非小众场景）。提 PR 前请再确认一遍：',
    '把项目名去掉之后，判据是否仍然成立。',
    '',
  ];
  for (const e of candidates) {
    lines.push(`## ${e.id} · ${e.symptom ?? '(无 symptom)'}`);
    lines.push('');
    lines.push(`- **层**：${e.layer}`);
    lines.push(`- **根因**：${e.root_cause}`);
    lines.push(`- **改动**：${e.artifacts}`);
    if (e.regression) lines.push(`- **回归**：${e.regression}`);
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(HELP); process.exit(0); }
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const file = opt('--from') ?? 'learnings/LOG.md';
  if (!existsSync(file)) { console.error(`用法错误：日志不存在：${file}`); process.exit(2); }
  const deny = opt('--deny') ? DEFAULT_DENY.concat(opt('--deny').split(',').map((s) => s.trim())) : DEFAULT_DENY;
  const entries = parseLog(readFileSync(file, 'utf8'));
  const assessed = entries.map((e) => ({ entry: e, ...assess(e, deny) }));
  const candidates = assessed.filter((a) => a.ok).map((a) => a.entry);
  const rejected = assessed.filter((a) => !a.ok);

  if (args.includes('--json')) { console.log(JSON.stringify({ file, candidates, rejected }, null, 2)); }
  else {
    console.log(`日志：${file}　共 ${entries.length} 条`);
    console.log(`可回流：${candidates.length} 条`);
    for (const e of candidates) console.log(`  ✓ ${e.id}  ${e.layer}  ${e.symptom}`);
    if (rejected.length) {
      console.log(`不回流：${rejected.length} 条（原因）`);
      for (const a of rejected) console.log(`  · ${a.entry.id ?? '?'}  ${a.reasons.join('；')}`);
    }
  }
  const out = opt('--write');
  if (out) { writeFileSync(out, toMarkdown(candidates, file)); console.log(`\n已写入 ${out}`); }
  process.exit(candidates.length ? 0 : 1);
}

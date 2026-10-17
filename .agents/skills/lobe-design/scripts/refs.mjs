#!/usr/bin/env node
// lobe-design progressive disclosure resolver. Zero dependencies.
// Usage: node scripts/refs.mjs "<instruction>" [--json] [--stage <id>] [--all]
//
// Answers one question: 这次到底该把哪些 reference 的哪些条目读进上下文？
// - tier `flat`  : 文件本身很小，整份加载
// - tier `index` : 只加载 always 条目 + 命中本次指令的 deep 条目；其余只读标题，需要时再展开
// - tier `profile`: 互斥分支（75-copy 的文案 profile）。只加载被选中的那一份，其余跳过。
//   选择顺序：--profile → 项目层 .agents/ux/product.md 的 `copy-profile:` → 指令里的 triggers → 都没有就不加载并提示先选。
// 每份 reference 顶部的 <!-- refs:meta ... --> 块是唯一事实源（由 check-structure.mjs 校验）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, PIPELINE } from './route.mjs';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const refDir = join(skillDir, 'references');

// 单个 stage 无条件加载的字节上限（超过说明 always/index 划分不合理）
export const ALWAYS_BUDGET = 32 * 1024;

export function parseMeta(file) {
  const text = readFileSync(join(refDir, file), 'utf8');
  const m = text.match(/<!--\s*refs:meta\n([\s\S]*?)-->/);
  if (!m) return null;
  const meta = { file, tier: null, scope: null, entries: [], bytes: Buffer.byteLength(text, 'utf8'), text };
  let inEntries = false;
  for (const raw of m[1].split('\n')) {
    if (!raw.trim()) continue;
    if (/^entries:\s*$/.test(raw)) { inEntries = true; continue; }
    if (!inEntries) {
      const kv = raw.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
      continue;
    }
    const parts = raw.trim().split(/\s*\|\s*/);
    if (parts.length < 2) continue;
    meta.entries.push({ id: parts[0], tier: parts[1], triggers: (parts[2] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) });
  }
  return meta;
}

export function allMeta() {
  const out = new Map();
  for (const f of readdirSync(refDir).filter((n) => n.endsWith('.md'))) out.set(`references/${f}`, parseMeta(f));
  return out;
}

// 命中判据：指令文本里出现该条目的任一 trigger。
// 「下限」由 refs:meta 里的 always 条目定义（每份文件自己声明哪几条每次都要读）；
// stage 的「只加载」节是**许可范围**（隔离边界），不是加载下限——把它当下限会让每次任务都把整份文件读进来。
function matchEntries(entries, text) {
  const hit = [];
  for (const e of entries) {
    if (e.tier === 'always' || /^index$/i.test(e.id)) continue;
    if (e.triggers.some((t) => t && text.includes(t))) hit.push(e.id);
  }
  return hit;
}

// 读项目层的文案 profile：`copy-profile: consumer; /admin → admin`（第一个是默认，其余按路由分区）
export function readCopyProfile(root) {
  const f = join(root, '.agents', 'ux', 'product.md');
  if (!existsSync(f)) return null;
  const line = readFileSync(f, 'utf8').match(/copy-profile\s*[:：]\s*`?([^`\n]+)`?/i)?.[1];
  if (!line) return null;
  const parts = line.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
  const areas = [];
  let def = null;
  for (const p of parts) {
    // 一个 profile 可以对应多条路由：`/settings, /resource → saas`
    const m = p.match(/^(\S.*?)\s*(?:→|->|=>|:)\s*([a-z-]+)$/);
    if (m) for (const path of m[1].split(/[,，\s]+/).filter(Boolean)) areas.push({ path, id: m[2] });
    else if (!def && /^[a-z-]+$/.test(p)) def = p;
  }
  return { default: def, areas };
}

// 选出这次要加载的 profile id 列表
export function selectProfiles(metas, text, { profile, root } = {}) {
  const profs = [...metas.values()].filter((m) => m?.tier === 'profile');
  const ids = new Set(profs.map((m) => m.profile));
  if (profile) return ids.has(profile) ? { selected: [profile], source: 'flag' } : { selected: [], source: 'flag', error: `未知 profile：${profile}（可用：${[...ids].join(', ')}）` };
  const hitIds = profs.filter((m) => (m.triggers ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((t) => text.includes(t))).map((m) => m.profile);
  const proj = root ? readCopyProfile(root) : null;
  if (proj && (proj.default || proj.areas.length)) {
    const area = proj.areas.find((a) => text.includes(a.path.toLowerCase()) && ids.has(a.id));
    if (area) return { selected: [area.id], source: `product.md（${area.path}）` };
    const cands = [proj.default, ...proj.areas.map((a) => a.id)].filter((id) => id && ids.has(id));
    const byTrigger = cands.find((id) => hitIds.includes(id));
    if (byTrigger || cands[0]) return { selected: [byTrigger ?? cands[0]], source: 'product.md' };
  }
  if (hitIds.length) return { selected: hitIds, source: 'instruction' };
  return { selected: [], source: 'none' };
}

// 一份文件在该指令下的加载计划
export function planRef(meta, text, chosen = []) {
  if (!meta) return { file: null, tier: null, load: 'missing', entries: [], bytes: 0 };
  // profile = 互斥分支：只有被选中的那一份整份加载，其余不读
  if (meta.tier === 'profile') return chosen.includes(meta.profile)
    ? { file: meta.file, tier: 'profile', profile: meta.profile, load: 'full', entries: [], bytes: meta.bytes }
    : { file: meta.file, tier: 'profile', profile: meta.profile, load: 'skip', entries: [], bytes: 0 };
  // flat = 整份加载（文件小到切片没有收益）
  if (meta.tier === 'flat') return { file: meta.file, tier: 'flat', load: 'full', entries: [], bytes: meta.bytes };
  const deep = matchEntries(meta.entries, text);
  const always = meta.entries.filter((e) => e.tier === 'always').map((e) => e.id);
  return {
    file: meta.file,
    tier: 'index',
    load: deep.length ? 'index+deep' : 'index-only',
    entries: [...always, ...deep],
    // 只读标题的成本：meta 块 + scope 行；用于预算校验
    bytes: deep.length ? meta.bytes : Math.min(meta.bytes, 1024),
  };
}

// 给定指令（可选指定 stage），产出每个 stage 的加载清单
export function resolveRefs(instruction, { stage, profile, root } = {}) {
  const metas = allMeta();
  const r = route(instruction);
  const text = instruction.toLowerCase();
  // 显式指定 stage 时直接读 pipeline.json，不依赖路由结果
  // （否则「模型 / 丑」这类归一化指令或模糊指令会解析不到任何 stage）。
  const plan = stage
    ? [{ stage, file: PIPELINE.stages[stage]?.file, refs: PIPELINE.stages[stage]?.loads ?? [] }]
    : r.loads;
  if (stage && !PIPELINE.stages[stage]) return { instruction, scenario: r.scenario, granularity: r.granularity, stages: [], budget: ALWAYS_BUDGET, error: `未知 stage：${stage}` };
  const copyProfile = selectProfiles(metas, text, { profile, root });
  const out = [];
  for (const st of plan) {
    if (!st.file) continue;
    const refs = st.refs.map((f) => planRef(metas.get(f), text, copyProfile.selected));
    out.push({ stage: st.stage, file: st.file, refs, bytes: refs.reduce((a, b) => a + b.bytes, 0) });
  }
  const usesProfile = out.some((s) => s.refs.some((x) => x.tier === 'profile'));
  return { instruction, scenario: r.scenario, granularity: r.granularity, stages: out, budget: ALWAYS_BUDGET, copyProfile: usesProfile ? copyProfile : null };
}

function format(res) {
  const out = [`指令：${res.instruction}`, `场景：${res.scenario ?? '未识别'}　颗粒度：${res.granularity}`, ''];
  for (const s of res.stages) {
    const over = s.bytes > res.budget ? `　⚠ 超出预算 ${res.budget}` : '';
    out.push(`${s.stage}　共 ${(s.bytes / 1024).toFixed(1)}KB${over}`);
    for (const r of s.refs) {
      if (!r.file) { out.push(`  ? 缺少 refs:meta`); continue; }
      if (r.tier === 'profile' && r.load === 'skip') continue;
      const label = r.load === 'full' ? (r.tier === 'profile' ? `整份（profile = ${r.profile}）` : '整份') : r.entries.length ? `索引 + ${r.entries.join(', ')}` : '只读索引';
      out.push(`  ${r.file}  [${r.tier}] ${label}`);
    }
  }
  if (res.copyProfile) {
    const cp = res.copyProfile;
    out.push('', cp.selected.length
      ? `文案 profile：${cp.selected.join(', ')}（来源：${cp.source}）；其余 profile 文件不读`
      : `文案 profile：未选定 —— 先读 .agents/ux/product.md 的 copy-profile，或追问用户（--profile / --root 指定）${cp.error ? `；${cp.error}` : ''}`);
  }
  out.push('', '只加载上面列出的条目；需要别的条目时，按 id 单独展开，不要整份读。');
  return out.join('\n');
}

const HELP = `lobe-design refs — 渐进式披露解析器（零依赖）

用法
  node scripts/refs.mjs "<指令原文>"              按路由器结果列出每个 stage 该读哪些条目
  node scripts/refs.mjs "<指令>" --stage 50-visual  只看某个 stage
  node scripts/refs.mjs "<指令>" --json            JSON 输出
  node scripts/refs.mjs "<指令>" --profile admin   75-copy：指定文案 profile（consumer | saas | admin | devtool）
  node scripts/refs.mjs "<指令>" --root <项目根>   75-copy：从 .agents/ux/product.md 的 copy-profile 选 profile（默认当前目录）
  node scripts/refs.mjs --audit                    审计全部 reference 的 tier / always 预算

tier
  flat   文件很小，整份加载
  index  只加载 always 条目 + 命中本次指令的 deep 条目；其余只读标题
  profile 互斥分支，只加载被选中的一份（--profile > product.md > 指令 triggers）

reference 顶部的 refs:meta 块是唯一事实源，由 check-structure.mjs 校验。
退出码：0 通过 · 1 预算超标 · 2 用法错误`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(HELP); process.exit(0); }
  if (args.includes('--audit')) {
    const metas = allMeta();
    let over = 0;
    for (const [f, m] of metas) {
      if (!m) { console.log(`FAIL ${f} 缺少 refs:meta`); over++; continue; }
      const always = m.entries.filter((e) => e.tier === 'always');
      console.log(`${m.tier.padEnd(7)} ${f.padEnd(34)} ${(m.bytes / 1024).toFixed(1).padStart(5)}KB  always=${always.length} deep=${m.entries.length - always.length}`);
    }
    process.exit(over ? 1 : 0);
  }
  const json = args.includes('--json');
  const stage = args.includes('--stage') ? args[args.indexOf('--stage') + 1] : undefined;
  const profile = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : undefined;
  // 不带 --root 时默认当前目录，和 bootstrap / project-scan 一致：项目根下运行即可读到 .agents/ux/product.md
  const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd();
  const instruction = args.filter((a, i) => !a.startsWith('--') && !['--stage', '--profile', '--root'].includes(args[i - 1])).join(' ');
  if (!instruction) { console.error(`用法错误：缺少指令。\n\n${HELP}`); process.exit(2); }
  if (stage && !PIPELINE.stages[stage]) {
    console.error(`用法错误：未知 stage：${stage}\n可用：${Object.keys(PIPELINE.stages).join(', ')}`);
    process.exit(2);
  }
  const res = resolveRefs(instruction, { stage, profile, root });
  if (res.copyProfile?.error) { console.error(`用法错误：${res.copyProfile.error}`); process.exit(2); }
  if (json) console.log(JSON.stringify(res, null, 2));
  else console.log(format(res));
  const over = res.stages.filter((s) => s.bytes > res.budget);
  if (over.length) { console.error(`预算超标：${over.map((s) => s.stage).join(', ')} > ${res.budget} 字节`); process.exit(1); }
}

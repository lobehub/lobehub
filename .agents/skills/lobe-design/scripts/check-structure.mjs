#!/usr/bin/env node
// lobe-design structure + isolation checker. Zero dependencies.
// Usage: node scripts/check-structure.mjs [--repo <dir>]  (default scope: this skill dir)
// Verifies: single SKILL.md entry + frontmatter; every stage has the required contract sections;
// each stage only cites rule ids from its allowlist (concern isolation); every cited rule id is defined;
// pipeline.json files exist; every stage is reachable from SKILL.md and from at least one scenario.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

// scanRoot：「单入口」检查只看 lobe-design 自己的目录（从脚本位置解析出的 skill 根）。
// skill 常被装进宿主项目的 .agents/skills/ 旁边还有别的 skill（ux、acceptance、.claude/skills 软链……），
// 扫宿主 git 根会把它们都算成「多入口」。--repo <dir> 可显式放宽到整个仓库。
const repoArg = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;
const scanRoot = repoArg ?? skillDir;
const P = JSON.parse(readFileSync(join(skillDir, 'scripts/pipeline.json'), 'utf8'));

const results = [];
const ok = (id, msg) => results.push({ level: 'PASS', id, msg });
const fail = (id, msg) => results.push({ level: 'FAIL', id, msg });

// 1) exactly one SKILL.md (ignore dependency dirs and any third-party skill vendored for reference)
const IGNORE = new Set(['node_modules', '.git', 'temp', '.backup', 'vendor']);
function findSkillMd(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (IGNORE.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) findSkillMd(p, out);
    else if (n === 'SKILL.md') out.push(relative(scanRoot, p) || 'SKILL.md');
  }
  return out;
}
const skillMds = findSkillMd(scanRoot);
skillMds.length === 1 ? ok('single-entry', `唯一入口：${skillMds[0]}`) : fail('single-entry', `发现 ${skillMds.length} 个 SKILL.md：${skillMds.join(', ')}`);

// 1b) the committed tree must also have one entry (a worktree-only deletion leaves a fresh clone with several skills).
//     Scoped to scanRoot (paths relative to it). Skipped when it is not inside a git checkout or git is unavailable.
{
  const g = spawnSync('git', ['-C', scanRoot, 'ls-files', '--', '.'], { encoding: 'utf8' });
  if (g.status === 0) {
    const tracked = g.stdout.split('\n').filter(Boolean).filter((p) => p.split('/').at(-1) === 'SKILL.md').filter((p) => !p.split('/').some((seg) => IGNORE.has(seg)));
    tracked.length <= 1
      ? ok('single-entry-git', `git 索引中的 SKILL.md：${tracked.join(', ') || '（未跟踪）'}`)
      : fail('single-entry-git', `git 索引中有 ${tracked.length} 个 SKILL.md：${tracked.join(', ')}（工作区删除后需提交）`);
  }
}

// 2) frontmatter
const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const fm = skillMd.match(/^---\n([\s\S]*?)\n---/);
if (!fm) fail('frontmatter', 'SKILL.md 缺少 frontmatter');
else {
  const missing = ['name', 'description', 'version'].filter((k) => !new RegExp(`^${k}:`, 'm').test(fm[1]));
  missing.length ? fail('frontmatter', `frontmatter 缺字段：${missing.join(', ')}`) : ok('frontmatter', 'frontmatter 含 name / description / version');
  const name = fm[1].match(/^name:\s*(.+)$/m)?.[1].trim();
  name === 'lobe-design' ? ok('frontmatter-name', 'name = lobe-design') : fail('frontmatter-name', `name = ${name}`);
}

// 3) rule id definitions across references
const refDir = join(skillDir, 'references');
const defined = new Set();
for (const f of readdirSync(refDir)) {
  const t = readFileSync(join(refDir, f), 'utf8');
  for (const m of t.matchAll(/^#{2,3}\s+([CDKEPAWXMIT]-\d{1,2})\b/gm)) defined.add(m[1]);
  for (const m of t.matchAll(/^\|\s*([AX]-\d{1,2}\.\d+)\s*\|/gm)) defined.add(m[1]);
}
ok('rules-defined', `已定义规则 ${defined.size} 条`);
const ID_RE = /\b([CDKEPAWXMIT])-(\d{2}|\d)(?:\.\d+)?\b/g;
const isDefined = (id) => defined.has(id) || defined.has(id.split('.')[0]) || /^X-\d$/.test(id) && defined.has(id);

function scanCitations(file) {
  const t = readFileSync(file, 'utf8');
  const bad = new Set();
  for (const m of t.matchAll(ID_RE)) { const id = m[0]; if (!isDefined(id)) bad.add(id); }
  return [...bad];
}
const citeFiles = [join(skillDir, 'SKILL.md'), ...readdirSync(join(skillDir, 'stages')).map((f) => join(skillDir, 'stages', f)), ...readdirSync(refDir).map((f) => join(refDir, f))];
const dangling = citeFiles.flatMap((f) => scanCitations(f).map((id) => `${relative(skillDir, f)}:${id}`));
dangling.length ? fail('no-dangling-ids', `悬空规则引用：${dangling.join(', ')}`) : ok('no-dangling-ids', `${citeFiles.length} 个文件里引用的规则编号都有定义`);

// 4) stage contracts + isolation
const REQUIRED = ['聚焦', '不负责', '输入', '只加载', '输出', '检查清单'];
const allowed = (stage, id) => {
  const list = P.stages[stage].allowedRuleIds;
  if (list.includes('*')) return true;
  const base = id.split('.')[0];
  return list.some((a) => a === id || a === base || (a.length === 1 && base.startsWith(a + '-')) || (a === 'X' && id.startsWith('X-')));
};
for (const [id, st] of Object.entries(P.stages)) {
  const file = join(skillDir, st.file);
  if (!existsSync(file)) { fail(`stage:${id}`, `缺少 ${st.file}`); continue; }
  const t = readFileSync(file, 'utf8');
  const heads = [...t.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  const miss = REQUIRED.filter((r) => !heads.some((h) => h.startsWith(r)));
  miss.length ? fail(`contract:${id}`, `${st.file} 缺少章节：${miss.join(', ')}`) : ok(`contract:${id}`, `${st.file} 含 聚焦/不负责/输入/只加载/输出/检查清单`);
  const usesBrief = id === '00-brief' || /00 brief|00 的/.test(t.split(/^## 输入/m)[1] ?? '');
  usesBrief ? ok(`brief-input:${id}`, `${id} 以 00 brief 为输入`) : fail(`brief-input:${id}`, `${id} 的「输入」没有引用 00 brief`);
  const cited = [...new Set([...t.matchAll(ID_RE)].map((m) => m[0]))];
  const leak = cited.filter((c) => !allowed(id, c));
  leak.length ? fail(`isolation:${id}`, `${id} 引用了不属于它的规则：${leak.join(', ')}`) : ok(`isolation:${id}`, `${id} 引用的 ${cited.length} 个规则编号都在白名单内`);
  const loadSection = (t.split(/^## 只加载/m)[1] ?? '').split(/^## /m)[0];
  const linked = [...loadSection.matchAll(/\]\(\.\.\/(references\/[\w-]+\.md)\)/g)].map((m) => m[1]);
  const extra = linked.filter((l) => !st.loads.includes(l));
  extra.length ? fail(`loads:${id}`, `${id}「只加载」里有 pipeline.json 未登记的文件：${extra.join(', ')}`) : ok(`loads:${id}`, `${id} 只加载 ${[...new Set(linked)].join(', ') || '—'}`);
  for (const l of st.loads) if (!existsSync(join(skillDir, l))) fail(`loads-exist:${id}`, `${l} 不存在`);
  skillMd.includes(st.file) ? ok(`linked:${id}`, `SKILL.md 链接了 ${st.file}`) : fail(`linked:${id}`, `SKILL.md 没有链接 ${st.file}`);
}

// 5) scenario mapping completeness
const REQUIRED_SCENARIOS = ['launch-visual', 'product-polish', 'operate-build', 'system-unify', 'screenshot-restore', 'pre-launch'];
for (const s of REQUIRED_SCENARIOS) {
  const sc = P.scenarios[s];
  if (!sc) { fail(`scenario:${s}`, '缺少场景'); continue; }
  const first = sc.pipeline[0][0];
  first === '00-brief' ? ok(`scenario:${s}`, `${s}: ${sc.pipeline.map((p) => p[0]).join(' → ')}`) : fail(`scenario:${s}`, `${s} 的 pipeline 不是从 00-brief 开始`);
  skillMd.includes(s) ? null : fail(`scenario-doc:${s}`, `SKILL.md 没有写场景 ${s}`);
}
const reached = new Set(Object.values(P.scenarios).flatMap((s) => s.pipeline.map((p) => p[0])));
const orphan = Object.keys(P.stages).filter((s) => !reached.has(s));
orphan.length ? fail('reachable', `没有任何场景用到：${orphan.join(', ')}`) : ok('reachable', '每个 stage 至少被一个场景使用');

// 5b) modelSignals：模型的口语说法必须指向真实存在、且有归属 stage 的规则 id。
//     之前模型词靠 stage keywords 承载，导致 00-brief（不在关注点表里）无法被路由到。
{
  const sig = P.modelSignals ?? {};
  const words = Object.entries(sig).filter(([k]) => !k.startsWith('$'));
  const bad = words.filter(([, id]) => !defined.has(id) || !P.ruleOwners[id]);
  bad.length
    ? fail('model-signals', `modelSignals 指向未定义或无归属的 id：${bad.map(([w, id]) => `${w}→${id}`).join(', ')}`)
    : ok('model-signals', `${words.length} 个模型词都能解析到唯一归属 stage`);
  // 模型词不应同时出现在 stage keywords 里（会走关注点通道，与单一归属冲突）
  const dup = [];
  for (const [id, s] of Object.entries(P.stages)) {
    for (const w of s.keywords) if (sig[w] && !w.startsWith('$')) dup.push(`${w}@${id}`);
  }
  dup.length
    ? fail('model-signals-dual', `模型词同时出现在 stage keywords 里（会双重路由）：${dup.join(', ')}`)
    : ok('model-signals-dual', '模型词只由 modelSignals 承载，未混入 stage keywords');
}

// 6) refs:meta —— 渐进式披露的声明必须存在且自洽（由 scripts/refs.mjs 消费）
{
  const TIERS = new Set(['flat', 'index', 'profile']);
  const declared = new Set();
  const profiles = new Map();
  let problems = 0;
  for (const f of readdirSync(refDir)) {
    const t = readFileSync(join(refDir, f), 'utf8');
    const m = t.match(/<!--\s*refs:meta\n([\s\S]*?)-->/);
    if (!m) { fail(`refs-meta:${f}`, `${f} 缺少 refs:meta 块（tier / scope / entries）`); problems++; continue; }
    const tier = m[1].match(/^tier:\s*(\S+)$/m)?.[1];
    const scope = m[1].match(/^scope:\s*(.+)$/m)?.[1];
    if (!tier || !TIERS.has(tier)) { fail(`refs-tier:${f}`, `${f} 的 tier 无效：${tier ?? '(缺)'}`); problems++; }
    if (!scope) { fail(`refs-scope:${f}`, `${f} 的 scope 为空：没有说明这份文件管什么`); problems++; }
    // profile：按产品类型只加载一份（75-copy）。必须声明 profile id 与 triggers，且 id 不重复。
    if (tier === 'profile') {
      const pid = m[1].match(/^profile:\s*([a-z-]+)\s*$/m)?.[1];
      const trig = m[1].match(/^triggers:\s*(.+)$/m)?.[1];
      if (!pid) { fail(`refs-profile:${f}`, `${f} 是 profile 但没有 profile: <id>`); problems++; }
      else if (profiles.has(pid)) { fail(`refs-profile:${f}`, `profile id 重复：${pid}（${profiles.get(pid)} / ${f}）`); problems++; }
      else profiles.set(pid, f);
      if (!trig) { fail(`refs-triggers:${f}`, `${f} 是 profile 但没有 triggers`); problems++; }
    }
    // flat 只要 scope；index 必须声明 entries（否则等于每次整份读）
    if (tier === 'index') {
      const rows = [...m[1].matchAll(/^\s{2}(\S.*?)\s*\|\s*(\w+)\s*\|/gm)].map((r) => ({ id: r[1].trim(), t: r[2] }));
      if (!rows.length) { fail(`refs-entries:${f}`, `${f} 是 index 但没有 entries`); problems++; continue; }
      const badTier = rows.filter((r) => !['always', 'deep'].includes(r.t));
      if (badTier.length) { fail(`refs-entry-tier:${f}`, `${f} 的条目 tier 只能是 always|deep：${badTier.map((r) => `${r.id}=${r.t}`).join(', ')}`); problems++; }
      for (const r of rows) {
        const id = r.id.replace(/§.*$/, '').trim();
        if (/^[A-Z]-\d/.test(id)) declared.add(id);
      }
    }
  }
  for (const id of declared) if (!defined.has(id)) { fail(`refs-entry-defined:${id}`, `refs:meta 声明的条目 ${id} 在 references 里没有定义`); problems++; }
  // profile 文件只能由一个 stage 加载（它们是互斥的分支），且该 stage 必须同时加载全部 profile
  {
    const profFiles = [...profiles.values()].map((f) => `references/${f}`);
    const owners = Object.entries(P.stages).filter(([, s]) => s.loads.some((l) => profFiles.includes(l)));
    const partial = owners.filter(([, s]) => !profFiles.every((l) => s.loads.includes(l)));
    if (profFiles.length && (owners.length !== 1 || partial.length)) { fail('refs-profile-owner', `profile 文件应只由一个 stage 整组登记：${owners.map(([id]) => id).join(', ') || '无'}`); problems++; }
    else if (profFiles.length) ok('refs-profile-owner', `${profFiles.length} 份 profile 只由 ${owners[0][0]} 登记：${[...profiles.keys()].join(' / ')}`);
  }
  if (!problems) ok('refs-meta', `${readdirSync(refDir).length} 份 reference 的 refs:meta 完整（tier / scope / entries 都对得上）`);
}

const f = results.filter((r) => r.level === 'FAIL');
for (const r of results) console.log(`${r.level} ${r.id.padEnd(26)} ${r.msg}`);
console.log(`RESULT: ${results.length - f.length} PASS, ${f.length} FAIL`);
process.exit(f.length ? 1 : 0);

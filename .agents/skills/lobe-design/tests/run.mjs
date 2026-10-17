#!/usr/bin/env node
// Runs every deterministic check of the skill. Usage (from skills/lobe-design/): node tests/run.mjs
// Sections: structure · routing · lint regressions · detail regressions · learnings gate · CLI contract.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync, unlinkSync} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from '../scripts/route.mjs';
import { isZhLocaleJson, lintText } from '../scripts/lint-lobe.mjs';
const lintPathsHas = (p) => isZhLocaleJson(p);
import { checkText } from '../scripts/check-detail.mjs';
import { checkLearnings } from '../scripts/check-learnings.mjs';
import { translate } from '../scripts/intent.mjs';
import { allMeta, resolveRefs } from '../scripts/refs.mjs';
import { applyBlock, detectContext, detectProjectLayer, findGuideFile, renderBlock } from '../scripts/bootstrap.mjs';
import { assessProjectLayer, fingerprintOf, parseInitMeta, renderInitMeta, scanProject } from '../scripts/project-scan.mjs';
import { assess } from '../scripts/upstream.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const skill = join(dir, '..');
const fx = join(dir, 'fixtures');
let pass = 0, fail = 0;
const t = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n     ${detail}`}`); };
// 子进程调用脚本（CLI 契约与 bootstrap 落盘测试共用）
const run = (script, args) => spawnSync(process.execPath, [join(skill, 'scripts', script), ...args], { encoding: 'utf8', cwd: skill });

// 1) structure / isolation
console.log('== check-structure');
try { const out = execFileSync(process.execPath, [join(skill, 'scripts/check-structure.mjs')], { encoding: 'utf8' }); t('check-structure', true); console.log(out.trim().split('\n').at(-1)); }
catch (e) { t('check-structure', false, e.stdout); }

// 1b) 回归：装进带兄弟 skill 的宿主仓库（.agents/skills/{ux,acceptance} + .claude/skills 软链），单入口检查只看自身目录
console.log('== check-structure in host repo');
if (spawnSync('git', ['--version']).status === 0) {
  const host = mkdtempSync(join(tmpdir(), 'ld-host-'));
  try {
    const skills = join(host, '.agents', 'skills');
    for (const s of ['ux', 'acceptance', 'linear-plan']) { mkdirSync(join(skills, s), { recursive: true }); writeFileSync(join(skills, s, 'SKILL.md'), `---\nname: ${s}\n---\n`); }
    const dest = join(skills, 'lobe-design');
    cpSync(skill, dest, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p) });
    mkdirSync(join(host, '.claude'), { recursive: true });
    symlinkSync('../.agents/skills', join(host, '.claude', 'skills'), 'dir');
    spawnSync('git', ['init', '-q', host]);
    spawnSync('git', ['-C', host, 'add', '-A']);
    const chk = () => spawnSync(process.execPath, [join(dest, 'scripts/check-structure.mjs')], { encoding: 'utf8', cwd: host });
    const a = chk();
    t('host repo: sibling skills + .claude symlink → check-structure exit 0', a.status === 0, a.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
    t('host repo: single-entry PASS', /PASS single-entry\s/.test(a.stdout) && /PASS single-entry-git/.test(a.stdout));
    // 意图保留：skill 目录里多出的 SKILL.md（工作区与 git 索引）仍然要报
    mkdirSync(join(dest, 'projects', 'x'), { recursive: true });
    writeFileSync(join(dest, 'projects', 'x', 'SKILL.md'), '---\nname: x\n---\n');
    spawnSync('git', ['-C', host, 'add', '-A']);
    const b = chk();
    t('host repo: stray projects/x/SKILL.md inside skill → single-entry FAIL', b.status !== 0 && /FAIL single-entry\s/.test(b.stdout));
    t('host repo: stray SKILL.md tracked → single-entry-git FAIL', /FAIL single-entry-git/.test(b.stdout));
  } finally { rmSync(host, { recursive: true, force: true }); }
} else console.log('skip: git unavailable');

// 2) routing regression
console.log('== route-cases');
const cases = JSON.parse(readFileSync(join(dir, 'route-cases.json'), 'utf8'));
for (const c of cases) {
  const r = route(c.instruction);
  const got = r.plan.map((p) => p.stage);
  const ok = r.granularity === c.granularity && (!c.scenario || r.scenario === c.scenario) && JSON.stringify(got) === JSON.stringify(c.stages)
    && (got.length === 0 || got[0] === '00-brief');
  t(`[${c.kind}] ${c.instruction}`, ok, `expected ${c.scenario ?? ''}/${c.granularity} ${c.stages.join('→')}  got ${r.scenario}/${r.granularity} ${got.join('→')}`);
}

// 3) lint regression: in every bad*.tsx each `expect:` id must be found on that line (and nothing unexpected);
//    every good*.tsx must be clean.
console.log('== lint fixtures');
const fixtures = readdirSync(fx);
for (const f of fixtures.filter((n) => /^bad.*\.tsx$/.test(n))) {
  const src = readFileSync(join(fx, f), 'utf8');
  const found = lintText(src, f);
  const expected = new Set();
  src.split('\n').forEach((line, i) => {
    const m = line.match(/expect:\s*([A-Z0-9\- ]+)/);
    if (!m) return;
    for (const id of m[1].trim().split(/\s+/)) {
      expected.add(`${i + 1}:${id}`);
      t(`${f}:${i + 1} → ${id}`, found.some((x) => x.line === i + 1 && x.id === id), `findings on line: ${found.filter((x) => x.line === i + 1).map((x) => x.id).join(',') || 'none'}`);
    }
  });
  const extra = found.filter((x) => !expected.has(`${x.line}:${x.id}`));
  t(`${f} has no unexpected findings`, extra.length === 0, extra.map((x) => `${x.line}:${x.id}`).join(', '));
}
for (const f of fixtures.filter((n) => /^good.*\.tsx$/.test(n))) {
  const found = lintText(readFileSync(join(fx, f), 'utf8'), f);
  t(`${f} has 0 lint findings`, found.length === 0, found.map((x) => `${x.line}:${x.id}`).join(', '));
}

// 4) detail checker regression: `expect-file:` header lists every id that must fire; good file must be clean.
console.log('== check-detail fixtures');
const detailBad = readFileSync(join(fx, 'detail-bad.tsx'), 'utf8');
const want = detailBad.match(/expect-file:\s*([A-Z0-9\- ]+)/)[1].trim().split(/\s+/);
const got = checkText(detailBad, 'detail-bad.tsx').map((f) => f.id);
for (const id of want) t(`detail-bad.tsx → ${id}`, got.includes(id));
t('detail-bad.tsx has no unexpected findings', got.every((id) => want.includes(id)), got.filter((id) => !want.includes(id)).join(','));
const detailGood = checkText(readFileSync(join(fx, 'detail-good.tsx'), 'utf8'), 'detail-good.tsx');
{
  const fetchSrc = 'const X = () => { fetch("/api"); return <div />; };\n';
  const ids = (src) => checkText(src, 'x.tsx').map((f) => f.id);
  t('detail: 没写理由的豁免不生效', ids(`// lobe-design-ignore DETAIL-NO-LOADING\n${fetchSrc}`).includes('DETAIL-NO-LOADING'));
  t('detail: 字符串里出现的豁免文字不生效', ids(`const s = 'lobe-design-ignore DETAIL-NO-LOADING: x';\n${fetchSrc}`).includes('DETAIL-NO-LOADING'));
  t('detail: 块注释里冒号后为空不算理由', ids(`/* lobe-design-ignore DETAIL-NO-LOADING: */\n${fetchSrc}`).includes('DETAIL-NO-LOADING'));
  t('detail: 冒号后为空不会借用下一行当理由', ids(`// lobe-design-ignore DETAIL-NO-LOADING:\nexport ${fetchSrc}`).includes('DETAIL-NO-LOADING'));
  t('detail: 理由只有注释符不算', ids(`// lobe-design-ignore DETAIL-NO-LOADING: //\n${fetchSrc}`).includes('DETAIL-NO-LOADING'));
  t('detail: 带理由的注释豁免生效', !ids(`// lobe-design-ignore DETAIL-NO-LOADING, DETAIL-NO-ERROR: 由父组件处理\n${fetchSrc}`).some((x) => x === 'DETAIL-NO-LOADING' || x === 'DETAIL-NO-ERROR'));
}
{
  const raw = (src) => lintText(src, 'src/x.ts').map((f) => f.id);
  t('lint: 字符串里的整文件豁免不生效', raw("const docs = 'lobe-design-ignore-file LOBE-RAW-COLOR: example';\nconst c = '#1677ff';\n").includes('LOBE-RAW-COLOR'));
  t('lint: 字符串里没理由的豁免文字不报 IGNORE-NO-REASON', !raw("const docs = 'lobe-design-ignore LOBE-RAW-COLOR';\n").includes('LOBE-IGNORE-NO-REASON'));
  t('lint: 行尾注释豁免仍生效', !raw("const c = '#1677ff'; // lobe-design-ignore LOBE-RAW-COLOR: 品牌色由设计稿指定\n").includes('LOBE-RAW-COLOR'));
  t('lint: 块注释豁免冒号后为空 → IGNORE-NO-REASON 且不生效', (() => { const r = raw("/* lobe-design-ignore LOBE-RAW-COLOR: */\nconst c = '#1677ff';\n"); return r.includes('LOBE-IGNORE-NO-REASON') && r.includes('LOBE-RAW-COLOR'); })());
  t('lint: 注释在字符串之后仍识别', !raw("const a = 'x'; const c = '#1677ff'; // lobe-design-ignore LOBE-RAW-COLOR: 演示\n").includes('LOBE-RAW-COLOR'));
}
{
  // 遍历时跳过软链目录：同一份文件只扫一次
  const tmp = mkdtempSync(join(tmpdir(), 'ld-symlink-'));
  try {
    mkdirSync(join(tmp, 'real'));
    writeFileSync(join(tmp, 'real', 'a.tsx'), 'const a = { color: \'#1677ff\' };\nconst X = () => { fetch("/api"); return <div />; };\n');
    symlinkSync(join(tmp, 'real'), join(tmp, 'alias'), 'dir');
    const lint = spawnSync(process.execPath, [join(skill, 'scripts', 'lint-lobe.mjs'), tmp, '--json'], { encoding: 'utf8' });
    const detail = spawnSync(process.execPath, [join(skill, 'scripts', 'check-detail.mjs'), tmp, '--json'], { encoding: 'utf8' });
    const lintFiles = new Set(JSON.parse(lint.stdout).findings?.map?.((f) => f.file) ?? JSON.parse(lint.stdout).map((f) => f.file));
    const detailHits = JSON.parse(detail.stdout).filter((f) => f.id === 'DETAIL-NO-LOADING').length;
    t('lint-lobe: 不进入软链目录', lintFiles.size === 1, [...lintFiles].join(','));
    t('check-detail: 不进入软链目录', detailHits === 1, String(detailHits));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
t('detail-good.tsx has 0 findings', detailGood.length === 0, detailGood.map((f) => f.id).join(','));

// 5b) 3.0.0 · 抽象指令翻译：归一化成可执行表述，或转成追问（不猜着动手）
console.log('== intent');
{
  const t1 = translate('这个页面体验不好');
  t('intent: 体验不好 → 40-flow', t1.stages.includes('40-flow') && t1.matches.length === 1);
  t('intent: 归一化出可执行表述', /还原成一次具体的失败/.test(t1.matches[0]?.executable ?? ''));
  t('intent: 给出要说清楚的量', (t1.matches[0]?.measures ?? []).length > 0);
  const t2 = translate('感觉不对');
  t('intent: 说不上来 → 追问而非猜测', t2.matches.length === 0 && t2.ask.length === 1);
  const t3 = translate('把间距调成 16px');
  t('intent: 具体指令不触发归一化', t3.matches.length === 0 && t3.ask.length === 0);
  // 归一化出的 stage 必须真的参与路由
  const r = route('这个列表页有点丑');
  t('intent: 丑 参与路由 → 50-visual', r.plan.map((p) => p.stage).includes('50-visual'));
  t('intent: 归一化不了的指令进入 clarify', route('说不上来哪里怪怪的').granularity === 'clarify');
}

// 5c) 3.0.0 · refs 渐进式披露：index 文件按条目加载，flat 整份；预算以内
console.log('== refs');
{
  const metas = allMeta();
  t('refs: 每份 reference 都有 refs:meta', [...metas.values()].every((m) => m && m.tier && m.scope));
  const r = resolveRefs('把列表页的间距调一下');
  const stage = r.stages.find((s) => s.stage === '50-visual');
  t('refs: 50-visual 解析出加载计划', !!stage);
  const aes = stage?.refs.find((x) => x.file === 'aesthetics.md');
  t('refs: index 文件只加载命中条目', aes?.load === 'index+deep' && aes.entries.includes('A-05'), JSON.stringify(aes));
  t('refs: 命中条目时仍包含 always 锚点', aes?.entries.includes('A-09'));
  // 未命中任何条目时不该整份读（用 --stage 固定到 50-visual，指令里没有任何 A-* 触发词）
  const cold = resolveRefs('zzz 无关键词 zzz', { stage: '50-visual' }).stages.find((s) => s.stage === '50-visual');
  const coldAes = cold?.refs.find((x) => x.file === 'aesthetics.md');
  t('refs: 无命中时只读索引，不整份读', coldAes?.load === 'index-only' && coldAes.bytes < metas.get('references/aesthetics.md').bytes, JSON.stringify(coldAes));
  // 每个 stage 的加载量在预算内
  const all = resolveRefs('做一个后台列表页，把间距和空态都处理一下');
  t('refs: 每个 stage 的加载量在预算内', all.stages.every((s) => s.bytes <= all.budget), all.stages.map((s) => `${s.stage}=${s.bytes}`).join(','));
  // flat 文件整份加载
  const reg = resolveRefs('把状态补齐，空态和加载都要');
  const d70 = reg.stages.find((s) => s.stage === '70-detail');
  t('refs: flat 文件整份加载', d70?.refs.some((x) => x.tier === 'flat' && x.load === 'full'));
  // 核心收益：只改间距时，不该把组件、审美全表拉进上下文
  const narrow = resolveRefs('把列表页的间距调一下', { stage: '50-visual' });
  const comp = narrow.stages[0].refs.find((x) => x.file === 'components.md');
  t('refs: 与本次无关的 reference 不整份读', !comp || comp.load === 'index-only');
  const craftNarrow = narrow.stages[0].refs.find((x) => x.file === 'craft.md');
  t('refs: 只改间距不加载动效 / a11y 条目', craftNarrow?.load === 'index-only', JSON.stringify(craftNarrow));
  // 命中动效时 craft 才展开
  const motion = resolveRefs('把入场动效调一下', { stage: '50-visual' });
  const craftMotion = motion.stages[0].refs.find((x) => x.file === 'craft.md');
  t('refs: 提到动效才加载 K-06', craftMotion?.entries.includes('K-06'), JSON.stringify(craftMotion));
}

// 5c2) 5.4.0 · 75-copy：profile 互斥，只加载选中的一份；zh-CN 语言包只跑文案规则
console.log('== copy profiles');
{
  const prof = (res) => res.stages.find((s) => s.stage === '75-copy')?.refs.filter((x) => x.tier === 'profile') ?? [];
  const loaded = (res) => prof(res).filter((x) => x.load === 'full').map((x) => x.profile);
  const a = resolveRefs('把后台审批页的提示文案改一下', { stage: '75-copy' });
  t('copy: 指令触发词选中 admin，只加载一份', JSON.stringify(loaded(a)) === '["admin"]' && a.copyProfile?.source === 'instruction', JSON.stringify(a.copyProfile));
  t('copy: 未选中的 profile 不计入加载量', prof(a).filter((x) => x.load === 'skip').every((x) => x.bytes === 0) && prof(a).length === 4);
  t('copy: copy-core 与 copy.md 每次整份', ['copy-core.md', 'copy.md'].every((f) => a.stages[0].refs.some((x) => x.file === f && x.load === 'full')));
  const b = resolveRefs('把后台的提示文案改一下', { stage: '75-copy', profile: 'devtool' });
  t('copy: --profile 优先于触发词', JSON.stringify(loaded(b)) === '["devtool"]' && b.copyProfile.source === 'flag');
  const c = resolveRefs('zzz 无关键词 zzz', { stage: '75-copy' });
  t('copy: 无 profile、无触发词 → 不加载任何 profile，提示先选', loaded(c).length === 0 && c.copyProfile?.source === 'none');
  const root = mkdtempSync(join(tmpdir(), 'ld-copy-'));
  try {
    mkdirSync(join(root, '.agents', 'ux'), { recursive: true });
    writeFileSync(join(root, '.agents', 'ux', 'product.md'), '# 产品画像\n\ncopy-profile: consumer; /admin → admin\n');
    const d = resolveRefs('把提示文案改一下', { stage: '75-copy', root });
    t('copy: product.md 的默认 profile', JSON.stringify(loaded(d)) === '["consumer"]' && d.copyProfile.source === 'product.md', JSON.stringify(d.copyProfile));
    const e = resolveRefs('把 /admin 下的提示文案改一下', { stage: '75-copy', root });
    t('copy: product.md 按路由分区选 profile', JSON.stringify(loaded(e)) === '["admin"]', JSON.stringify(e.copyProfile));
    const f2 = resolveRefs('把开发者 api 页的文案改一下', { stage: '75-copy', root });
    writeFileSync(join(root, '.agents', 'ux', 'product.md'), '# 产品画像\n\ncopy-profile: consumer; /settings, /resource → saas\n');
    const g = resolveRefs('把 /resource 页的文案改一下', { stage: '75-copy', root });
    t('copy: 一条分区可列多条路由', JSON.stringify(loaded(g)) === '["saas"]' && g.copyProfile.source.includes('/resource'), JSON.stringify(g.copyProfile));
    t('copy: product.md 存在时不被列表外的触发词带偏', JSON.stringify(loaded(f2)) === '["consumer"]', JSON.stringify(f2.copyProfile));
  } finally { rmSync(root, { recursive: true, force: true }); }
  t('copy: 其他 stage 不加载 profile 文件', resolveRefs('把列表页的间距调一下').stages.every((s) => s.stage === '75-copy' || !s.refs.some((x) => x.tier === 'profile')));
  {
    const cwdRoot = mkdtempSync(join(tmpdir(), 'ld-copy-cwd-'));
    try {
      mkdirSync(join(cwdRoot, '.agents', 'ux'), { recursive: true });
      writeFileSync(join(cwdRoot, '.agents', 'ux', 'product.md'), '# 产品画像\n\ncopy-profile: consumer\n');
      const r = spawnSync(process.execPath, [join(skill, 'scripts', 'refs.mjs'), '把提示文案改一下', '--stage', '75-copy', '--json'], { encoding: 'utf8', cwd: cwdRoot });
      const cp = r.status === 0 ? JSON.parse(r.stdout).copyProfile : null;
      t('refs.mjs 不带 --root 时读当前目录的 product.md', JSON.stringify(cp?.selected) === '["consumer"]' && cp?.source === 'product.md', r.stderr || JSON.stringify(cp));
    } finally { rmSync(cwdRoot, { recursive: true, force: true }); }
  }
  t('refs.mjs --profile 未知 → exit 2', run('refs.mjs', ['改文案', '--stage', '75-copy', '--profile', 'nope']).status === 2);
  // zh-CN 语言包：只跑 locale 规则；同样内容的 tsx 会跑全部规则
  const zh = '{\n  "save": "已保存API密钥",\n  "fail": "保存失败,请重试",\n  "ok": "已保存 API 密钥",\n  "color": "#ff0000"\n}\n';
  const zf = lintText(zh, 'locales/zh-CN/common.json').map((x) => `${x.line}:${x.id}`);
  t('copy: zh-CN 语言包报 CJK 留白与半角标点', JSON.stringify(zf) === '["2:LOBE-CJK-LATIN-SPACE","3:LOBE-HALFWIDTH-PUNCT"]', zf.join(','));
  t('copy: 语言包不跑非文案规则（#ff0000 不报 RAW-COLOR）', !zf.some((x) => x.includes('RAW-COLOR')));
  const rawColor = (src) => lintText(src, 'src/x.ts').filter((x) => x.id === 'LOBE-RAW-COLOR').map((x) => x.line);
  t('RAW-COLOR: 全透明哨兵值不报', rawColor("const BLANK = new Set(['transparent', 'rgba(0,0,0,0)', '#0000', '#00000000']);\n").length === 0);
  t('RAW-COLOR: 颜色作为比较操作数不报', rawColor("if (bg === 'rgba(0, 0, 0, 0.5)' || '#fff' !== fg) return;\n").length === 0);
  t('RAW-COLOR: 半透明 / 不透明颜色照报', JSON.stringify(rawColor("const a = { color: 'rgba(0,0,0,0.45)' };\nconst b = { color: '#1677ff' };\nconst c = { color: x === 'a' ? '#fff' : '#000' };\n")) === '[1,2,3]');
  t('copy: 非 zh-CN 的 json 不被扫描', !lintPathsHas('locales/en-US/common.json') && lintPathsHas('locales/zh-CN/common.json') && lintPathsHas('src/locales/zh_CN.json'));
}

// 5d) 3.0.0 · bootstrap：托管块可增量写入，块外内容一字不改，且幂等
console.log('== bootstrap');
{
  const block = renderBlock('3.0.0');
  // 已在文件里存在的内容必须原样保留
  const existing = '# 项目指南\n\n## 我们自己的规矩\n\n- 用 pnpm\n- 提交信息用中文\n';
  const once = applyBlock(existing, block);
  t('bootstrap: 追加托管块', once.action === 'appended' && once.text.includes(existing.trim()));
  t('bootstrap: 块内容是完整四节', ['入口与顺序', '什么时候用', '自迭代', '回流'].every((s) => once.text.includes(s)));
  // 幂等：再次写入同一块应保持不变
  const twice = applyBlock(once.text, renderBlock('3.0.0'));
  t('bootstrap: 重复运行幂等（unchanged）', twice.action === 'unchanged');
  // 版本升级只替换块，块外不动
  const bumped = applyBlock(once.text, renderBlock('9.9.9'));
  t('bootstrap: 版本升级只替换块', bumped.action === 'replaced' && bumped.text.includes('skill 版本 9.9.9'));
  t('bootstrap: 替换后块外内容仍在', bumped.text.includes('用 pnpm') && bumped.text.includes('我们自己的规矩'));
  t('bootstrap: 块外内容零改动（逐字比对）', bumped.text.startsWith('# 项目指南\n\n## 我们自己的规矩\n\n- 用 pnpm\n- 提交信息用中文\n'));
  // 没有 AGENTS.md 时建立；有则复用（探测顺序见 references/init.md I-01）
  t('bootstrap: 探测顺序 AGENTS.md 优先', findGuideFile(skill).name === 'AGENTS.md');

  // 4.1.0 · 托管块随 --root 的安装位置与 .agents/ux 变化，且输出确定
  const plain = renderBlock('4.1.0');
  t('bootstrap: 默认启用全局安装路径', /^export LOBE_DESIGN="\$\{HOME\}\/\.claude/m.test(plain) && /^# export LOBE_DESIGN="\.\/\.agents/m.test(plain));
  t('bootstrap: 无 .agents/ux 时不写项目层指针节', !plain.includes('### 项目层规范') && plain.includes('项目自己的规则文件') && plain.includes('装完或升级后先初始化'));
  const local = renderBlock('4.1.0', undefined, undefined, { localSkill: true, ux: null });
  t('bootstrap: 仓库内安装时默认启用 ./.agents/skills/lobe-design', /^export LOBE_DESIGN="\.\/\.agents\/skills\/lobe-design"$/m.test(local) && !/^export LOBE_DESIGN="\$\{HOME\}/m.test(local));
  const withUx = renderBlock('4.1.0', undefined, undefined, { localSkill: true, ux: ['product.md', 'lobe-design-rules.md', 'audit/'] });
  t('bootstrap: .agents/ux 指针只列存在的文件', ['.agents/ux/product.md', '.agents/ux/lobe-design-rules.md', '.agents/ux/audit/', '00-brief'].every((s) => withUx.includes(s)) && !withUx.includes('.agents/ux/cases.md'));
  t('bootstrap: 指针节在第 1 节之前', withUx.indexOf('项目层规范') < withUx.indexOf('### 1. 入口与顺序'));
  const iHost = withUx.indexOf('在本项目里记'), iRepo = withUx.indexOf('回流落地后（在 skill 仓库里');
  t('bootstrap: 自迭代分宿主 / skill 仓库两层', iHost > 0 && iRepo > iHost && withUx.slice(iHost, iRepo).includes('`.agents/ux/lobe-design-rules.md`') && !withUx.slice(iHost, iRepo).includes('CHANGELOG'));
  t('bootstrap: 同一上下文输出确定', renderBlock('4.1.0', undefined, undefined, { localSkill: true, ux: ['product.md'] }) === renderBlock('4.1.0', undefined, undefined, { localSkill: true, ux: ['product.md'] }));
  const uxOnce = applyBlock('# x\n', withUx);
  t('bootstrap: 带指针的块幂等', applyBlock(uxOnce.text, withUx).action === 'unchanged');

  // 文件系统级 e2e：真的落盘，再逐字核对块外内容（纯内存测不到的失败方式）
  const tmp = mkdtempSync(join(tmpdir(), 'lobe-bootstrap-'));
  try {
    const original = '# 项目指南\n\n## 我们自己的规矩\n\n- 用 pnpm 而不是 npm\n- 提交信息用中文\n';
    const guide = join(tmp, 'AGENTS.md');
    writeFileSync(guide, original);
    const b = run('bootstrap.mjs', ['--root', tmp]);
    t('bootstrap fs: 写入成功', b.status === 0, b.stderr);
    const after = readFileSync(guide, 'utf8');
    t('bootstrap fs: 块外内容逐字保留', after.startsWith(original), after.slice(0, 80));
    t('bootstrap fs: 托管块恰好一个', (after.match(/lobe-design:begin/g) ?? []).length === 1);
    // 幂等：再跑一次文件不变
    const once = readFileSync(guide, 'utf8');
    run('bootstrap.mjs', ['--root', tmp]);
    t('bootstrap fs: 重复运行文件不变（幂等）', readFileSync(guide, 'utf8') === once);
    // --check 语义
    t('bootstrap fs: --check 已接入 → 0', run('bootstrap.mjs', ['--check', '--root', tmp]).status === 0);
    // 格式化工具只改空白 / 表格分隔线时不算过期；托管块内容真正变了才算
    const fmt = readFileSync(guide, 'utf8').replace(/\| --- \|/g, '| ------ |').replace(/ \|\n/g, '  |\n').replace('修误报 · minor', '修误报・minor').replace('入口与顺序', '入口 与顺序');
    writeFileSync(guide, fmt);
    t('bootstrap fs: --check 只是重新格式化 → 0', run('bootstrap.mjs', ['--check', '--root', tmp]).status === 0);
    writeFileSync(guide, once.replace('node "$LOBE_DESIGN/scripts/route.mjs"', 'node"$LOBE_DESIGN/scripts/route.mjs"'));
    t('bootstrap fs: --check 命令里删掉空格算过期 → 1', run('bootstrap.mjs', ['--check', '--root', tmp]).status === 1);
    writeFileSync(guide, once.replace('## 1.', '## 1. 过期'));
    const drift = run('bootstrap.mjs', ['--check', '--json', '--root', tmp]);
    t('bootstrap fs: --check 托管块内容过期 → 1', drift.status === 1 && JSON.parse(drift.stdout).blockCurrent === false, drift.stdout);
    writeFileSync(guide, once);
    const fresh = mkdtempSync(join(tmpdir(), 'lobe-fresh-'));
    t('bootstrap fs: --check 未接入 → 1', run('bootstrap.mjs', ['--check', '--root', fresh]).status === 1);
    rmdirSync(fresh, { recursive: true });
    // 版本落后时 --check 必须失败（否则升级不会被发现）
    writeFileSync(guide, readFileSync(guide, 'utf8').replace(/skill 版本 [\d.]+/, 'skill 版本 1.0.0'));
    t('bootstrap fs: --check 版本落后 → 1', run('bootstrap.mjs', ['--check', '--root', tmp]).status === 1);
    // CLAUDE.md 兜底：没有 AGENTS.md 时写入 CLAUDE.md
    const tmp2 = mkdtempSync(join(tmpdir(), 'lobe-claude-'));
    writeFileSync(join(tmp2, 'CLAUDE.md'), '# CLAUDE\n');
    run('bootstrap.mjs', ['--root', tmp2]);
    t('bootstrap fs: 无 AGENTS.md 时写入 CLAUDE.md', readFileSync(join(tmp2, 'CLAUDE.md'), 'utf8').includes('lobe-design:begin'));
    t('bootstrap fs: 不新建 AGENTS.md', !existsSync(join(tmp2, 'AGENTS.md')));
    rmdirSync(tmp2, { recursive: true });
    // 宿主项目布局：.agents/skills/lobe-design + .agents/ux
    const tmp3 = mkdtempSync(join(tmpdir(), 'lobe-host-'));
    mkdirSync(join(tmp3, '.agents/skills/lobe-design'), { recursive: true });
    mkdirSync(join(tmp3, '.agents/ux/audit'), { recursive: true });
    writeFileSync(join(tmp3, '.agents/ux/product.md'), '# p\n');
    writeFileSync(join(tmp3, '.agents/ux/lobe-design-rules.md'), '# r\n');
    writeFileSync(join(tmp3, 'AGENTS.md'), '# host\n');
    const ctx3 = detectContext(tmp3);
    t('bootstrap fs: 探测到仓库内安装与 ux 文件（固定顺序）', ctx3.localSkill && JSON.stringify(ctx3.ux) === JSON.stringify(['product.md', 'lobe-design-rules.md', 'audit/']), JSON.stringify(ctx3));
    t('bootstrap fs: 无 .agents 时上下文为空', JSON.stringify(detectContext(join(tmp3, '.agents/ux/audit'))) === JSON.stringify({ localSkill: false, ux: null }));
    run('bootstrap.mjs', ['--root', tmp3]);
    const host1 = readFileSync(join(tmp3, 'AGENTS.md'), 'utf8');
    t('bootstrap fs: 宿主项目块指向仓库内安装与 ux', host1.includes('export LOBE_DESIGN="./.agents/skills/lobe-design"\n') && host1.includes('.agents/ux/product.md') && host1.startsWith('# host\n'));
    const r3 = run('bootstrap.mjs', ['--root', tmp3, '--json']);
    t('bootstrap fs: 宿主项目重复运行 unchanged', JSON.parse(r3.stdout).action === 'unchanged' && readFileSync(join(tmp3, 'AGENTS.md'), 'utf8') === host1);
    rmSync(tmp3, { recursive: true, force: true });
  } finally {
    rmdirSync(tmp, { recursive: true });
  }
}

// 5d2) 5.2.0 · project-scan：确定性事实 + 项目层 check
console.log('== project-scan');
{
  const tmp = mkdtempSync(join(tmpdir(), 'lobe-scan-'));
  try {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      name: 'demo-app',
      description: 'A demo console',
      dependencies: { next: '15.0.0', react: '19.0.0', '@lobehub/ui': '2.0.0' },
    }));
    writeFileSync(join(tmp, 'README.md'), '# Demo\n\nAdmin console for operators.\n');
    mkdirSync(join(tmp, 'src/components'), { recursive: true });
    writeFileSync(join(tmp, 'src/components/Foo.tsx'), 'export const Foo = () => null;\n');
    mkdirSync(join(tmp, 'app'), { recursive: true });
    mkdirSync(join(tmp, 'app/settings'), { recursive: true });

    const facts = scanProject(tmp);
    t('project-scan: 识别 nextjs + web', facts.stack.frameworks.includes('nextjs') && facts.stack.platforms.includes('web'), JSON.stringify(facts.stack));
    t('project-scan: 识别 lobe-ui', facts.stack.uiLibs.includes('@lobehub/ui'));
    t('project-scan: 发现组件目录', facts.components.some((c) => c.dir === 'src/components'));
    t('project-scan: 发现路由目录', facts.routes.some((r) => r.dir === 'app'));
    t('project-scan: 指纹稳定', fingerprintOf(facts) === facts.fingerprint && facts.fingerprint.length === 12);
    // 组件目录超过样本上限后，增删文件仍要改变指纹
    for (let i = 0; i < 60; i++) writeFileSync(join(tmp, `src/components/Gen${i}.tsx`), 'export {};\n');
    const many = scanProject(tmp);
    writeFileSync(join(tmp, 'src/components/Gen60.tsx'), 'export {};\n');
    const more = scanProject(tmp);
    t('project-scan: 超过样本上限时文件数仍计全量且影响指纹', more.components.find((c) => c.dir === 'src/components')?.fileCount === 62 && more.fingerprint !== many.fingerprint, JSON.stringify(more.components));
    for (let i = 0; i <= 60; i++) unlinkSync(join(tmp, `src/components/Gen${i}.tsx`));
    // 文件数不变的改名 / 路由子目录替换也要改变指纹
    const base = scanProject(tmp).fingerprint;
    writeFileSync(join(tmp, 'src/components/Bar.tsx'), 'export {};\n'); unlinkSync(join(tmp, 'src/components/Foo.tsx'));
    const renamed = scanProject(tmp).fingerprint;
    rmdirSync(join(tmp, 'app/settings')); mkdirSync(join(tmp, 'app/profile'));
    const rerouted = scanProject(tmp).fingerprint;
    t('project-scan: 同数量改名 / 路由替换改变指纹', base !== renamed && renamed !== rerouted, `${base} ${renamed} ${rerouted}`);
    writeFileSync(join(tmp, 'src/components/Foo.tsx'), 'export const Foo = () => null;\n'); unlinkSync(join(tmp, 'src/components/Bar.tsx'));
    // 超过样本上限的目录里，样本之外的同数量改名也要改变指纹
    for (let i = 0; i < 30; i++) writeFileSync(join(tmp, `src/components/F${String(i).padStart(2, '0')}.tsx`), 'export {};\n');
    const before30 = scanProject(tmp).fingerprint;
    unlinkSync(join(tmp, 'src/components/F25.tsx')); writeFileSync(join(tmp, 'src/components/Z25.tsx'), 'export {};\n');
    t('project-scan: 样本之外的改名也改变指纹', scanProject(tmp).fingerprint !== before30);
    for (let i = 0; i < 30; i++) if (i !== 25) unlinkSync(join(tmp, `src/components/F${String(i).padStart(2, '0')}.tsx`));
    unlinkSync(join(tmp, 'src/components/Z25.tsx'));
    rmdirSync(join(tmp, 'app/profile')); mkdirSync(join(tmp, 'app/settings'));

    t('project-scan --check 缺文件 → 1', run('project-scan.mjs', ['--check', '--root', tmp]).status === 1);
    const layer0 = detectProjectLayer(tmp);
    t('bootstrap detectProjectLayer: 缺两份', layer0.missing.length === 2 && !layer0.ok);

    mkdirSync(join(tmp, '.agents/ux'), { recursive: true });
    const meta = renderInitMeta(facts.skillVersion, facts.fingerprint);
    writeFileSync(join(tmp, '.agents/ux/product.md'), `${meta}\n# 产品画像\n平台：web\n`);
    writeFileSync(join(tmp, '.agents/ux/components.md'), `${meta}\n# 组件盘点\n`);
    t('project-scan: parseInitMeta', parseInitMeta(readFileSync(join(tmp, '.agents/ux/product.md'), 'utf8'))?.fingerprint === facts.fingerprint);
    const a1 = assessProjectLayer(scanProject(tmp));
    t('project-scan: 齐全且指纹匹配', a1.ok && a1.missing.length === 0 && a1.stale.length === 0, JSON.stringify(a1));
    t('project-scan --check 齐全 → 0', run('project-scan.mjs', ['--check', '--root', tmp]).status === 0);

    // 过期：版本落后
    writeFileSync(join(tmp, '.agents/ux/product.md'), `${renderInitMeta('0.0.1', facts.fingerprint)}\n# p\n`);
    const a2 = assessProjectLayer(scanProject(tmp));
    t('project-scan: 版本过期 → stale', a2.stale.some((s) => s.includes('0.0.1')) && a2.missing.length === 0, JSON.stringify(a2));
    const chkStale = run('project-scan.mjs', ['--check', '--root', tmp]);
    t('project-scan --check 仅过期 → 0 + WARN', chkStale.status === 0 && /WARN/.test(chkStale.stderr + chkStale.stdout));

    // bootstrap --check WARN 项目层
    writeFileSync(join(tmp, 'AGENTS.md'), '# x\n');
    run('bootstrap.mjs', ['--root', tmp]);
    // 恢复齐全 meta 后缺 components 应 WARN
    unlinkSync(join(tmp, '.agents/ux/components.md'));
    run('bootstrap.mjs', ['--root', tmp]);
    const bchk = run('bootstrap.mjs', ['--check', '--root', tmp]);
    t('bootstrap --check 已接入但缺 components → 0 + WARN', bchk.status === 0 && /WARN/.test(bchk.stderr + bchk.stdout), bchk.stderr + bchk.stdout);

    const withComp = renderBlock('5.2.0', undefined, undefined, { localSkill: true, ux: ['product.md', 'components.md', 'lobe-design-rules.md'] });
    t('bootstrap: 指针含 components.md', withComp.includes('.agents/ux/components.md') && withComp.includes('组件盘点'));
    t('bootstrap: 托管块含升级后刷新', withComp.includes('升级后刷新') && withComp.includes('05-init'));
    t('bootstrap: 先读项目层', withComp.includes('先读') && withComp.includes('product.md'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 5d3) 5.4.2 · install.sh：--copy 重装备份到 cache，不在项目内留 *.bak.*
console.log('== install.sh backup');
{
  const repoRoot = join(skill, '..', '..');
  const installSh = join(repoRoot, 'install.sh');
  if (!existsSync(installSh)) {
    // 以 install.sh --copy 装进项目（.agents/skills/lobe-design）时没有 skill 仓库根的 install.sh，跳过
    console.log(`SKIP install.sh 不在 ${installSh}（非 skill 源仓库布局）`);
  } else {
    const cacheHome = mkdtempSync(join(tmpdir(), 'ld-xdg-'));
    const proj = mkdtempSync(join(tmpdir(), 'my-app-'));
    const skillsDir = join(proj, '.agents', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    const envFor = (extra = {}) => ({ ...process.env, XDG_CACHE_HOME: cacheHome, ...extra });
    const runInstall = (args, env) =>
      spawnSync('bash', [installSh, ...args, '--dir', skillsDir], { encoding: 'utf8', env: envFor(env) });
    const walkNames = (root) => {
      const out = [];
      const walk = (p) => {
        for (const n of readdirSync(p, { withFileTypes: true })) {
          const fp = join(p, n.name);
          out.push(n.name);
          if (n.isDirectory() && !n.isSymbolicLink()) walk(fp);
        }
      };
      if (existsSync(root)) walk(root);
      return out;
    };
    const bakInside = () => walkNames(proj).filter((n) => /\.bak\./.test(n));
    const projectLabel = (() => {
      // Mirrors install.sh project_basename_for for …/.agents/skills
      const base = proj.split(/[\\/]/).filter(Boolean).at(-1);
      return base.replace(/[^A-Za-z0-9._-]/g, '_') || 'project';
    })();
    const cacheBackups = () => {
      const root = join(cacheHome, 'lobe-design', 'backups');
      if (!existsSync(root)) return [];
      return readdirSync(root).filter((n) => n.startsWith(projectLabel + '-') && existsSync(join(root, n)));
    };

    const r1 = runInstall(['--copy']);
    t('install.sh first --copy → 0', r1.status === 0, (r1.stderr || '') + (r1.stdout || ''));
    t('install.sh first: skill landed', existsSync(join(skillsDir, 'lobe-design', 'SKILL.md')));
    t('install.sh first: no .bak in project', bakInside().length === 0, bakInside().join(','));

    writeFileSync(join(skillsDir, 'lobe-design', 'LOCAL_EDIT'), 'keep-me');
    const r2 = runInstall(['--copy']);
    t('install.sh reinstall --copy → 0', r2.status === 0, (r2.stderr || '') + (r2.stdout || ''));
    t('install.sh reinstall: no .bak.* inside project', bakInside().length === 0, bakInside().join(','));
    const backups = cacheBackups();
    t('install.sh reinstall: backup in XDG cache', backups.length >= 1, `cache=${cacheHome} backups=${backups.join(',')}`);
    t('install.sh reinstall: prints backup path', /backed up existing/.test(r2.stdout) && /lobe-design\/backups\//.test(r2.stdout), r2.stdout.split('\n').filter((l) => /backed|backup|warning/i.test(l)).join(' | '));
    const backupDir = join(cacheHome, 'lobe-design', 'backups', backups.sort().at(-1));
    t('install.sh reinstall: backup holds prior edit', existsSync(join(backupDir, 'LOCAL_EDIT')));
    t('install.sh reinstall: fresh tree has no LOCAL_EDIT', !existsSync(join(skillsDir, 'lobe-design', 'LOCAL_EDIT')));

    // prune: seed older backups, reinstall once more → keep ≤ 5
    const backupsRoot = join(cacheHome, 'lobe-design', 'backups');
    for (const ts of ['20260101000001', '20260101000002', '20260101000003', '20260101000004', '20260101000005', '20260101000006']) {
      mkdirSync(join(backupsRoot, `${projectLabel}-${ts}`), { recursive: true });
      writeFileSync(join(backupsRoot, `${projectLabel}-${ts}`, 'x'), '1');
    }
    writeFileSync(join(skillsDir, 'lobe-design', 'LOCAL_EDIT2'), 'x');
    const r3 = runInstall(['--copy']);
    t('install.sh prune run → 0', r3.status === 0, (r3.stderr || '') + (r3.stdout || ''));
    const afterPrune = cacheBackups();
    t('install.sh prune: keeps ≤ 5 per project', afterPrune.length <= 5, afterPrune.join(','));
    t('install.sh prune: still no .bak in project', bakInside().length === 0, bakInside().join(','));

    // --no-backup
    const beforeNo = cacheBackups().length;
    writeFileSync(join(skillsDir, 'lobe-design', 'LOCAL_EDIT3'), 'x');
    const r4 = runInstall(['--copy', '--no-backup']);
    t('install.sh --no-backup → 0', r4.status === 0, (r4.stderr || '') + (r4.stdout || ''));
    t('install.sh --no-backup: no new cache backup', cacheBackups().length === beforeNo, cacheBackups().join(','));
    t('install.sh --no-backup: mentions removed', /--no-backup/.test(r4.stdout));
    t('install.sh --no-backup: no .bak in project', bakInside().length === 0);

    // unwritable cache → skip backup with warning, never write into project
    const blocked = mkdtempSync(join(tmpdir(), 'ld-blocked-'));
    writeFileSync(join(blocked, 'lobe-design'), 'not-a-dir'); // mkdir lobe-design/backups must fail
    writeFileSync(join(skillsDir, 'lobe-design', 'LOCAL_EDIT4'), 'x');
    const r5 = runInstall(['--copy'], { XDG_CACHE_HOME: blocked });
    t('install.sh unwritable cache → 0', r5.status === 0, (r5.stderr || '') + (r5.stdout || ''));
    t('install.sh unwritable cache: warns', /warning:.*skipping backup|cannot write cache/i.test(r5.stderr + r5.stdout), r5.stderr + r5.stdout);
    t('install.sh unwritable cache: no .bak in project', bakInside().length === 0, bakInside().join(','));
    t('install.sh unwritable cache: reinstalled', existsSync(join(skillsDir, 'lobe-design', 'SKILL.md')) && !existsSync(join(skillsDir, 'lobe-design', 'LOCAL_EDIT4')));

    // symlink over a prior --copy: backup real dir to cache, then link
    writeFileSync(join(skillsDir, 'lobe-design', 'LOCAL_EDIT5'), 'x');
    const r6 = runInstall([]); // default symlink
    t('install.sh symlink over copy → 0', r6.status === 0, (r6.stderr || '') + (r6.stdout || ''));
    t('install.sh symlink over copy: dest is symlink', lstatSync(join(skillsDir, 'lobe-design')).isSymbolicLink());
    t('install.sh symlink over copy: no .bak in project', bakInside().length === 0);
    t('install.sh symlink over copy: backed up to cache', /backed up existing/.test(r6.stdout));

    // symlink reinstall: just replace the link, no backup needed
    const beforeSym = cacheBackups().length;
    const r7 = runInstall([]);
    t('install.sh symlink reinstall → 0', r7.status === 0, (r7.stderr || '') + (r7.stdout || ''));
    t('install.sh symlink reinstall: removed symlink note', /removed\s+symlink/.test(r7.stdout));
    t('install.sh symlink reinstall: no extra backup', cacheBackups().length === beforeSym);

    rmSync(proj, { recursive: true, force: true });
    rmSync(cacheHome, { recursive: true, force: true });
    rmSync(blocked, { recursive: true, force: true });
  }
}

// 5e) 3.0.0 · 回流上游：通用条目放行，带品牌印记 / 半成品被挡
console.log('== upstream');
{
  const good = { id: 'LRN-1', status: 'landed', version: '3.0.0', layer: 'lint', occurrences: '2', symptom: '按钮文案不是动词加对象', root_cause: '缺校验', artifacts: 'LOBE-VAGUE-BUTTON' };
  t('upstream: 通用条目放行', assess(good).ok);
  const branded = { ...good, symptom: 'lobehub-admin-enterprise 的列表页按钮不统一' };
  t('upstream: 品牌印记被挡', !assess(branded).ok && assess(branded).reasons.some((r) => r.includes('印记')));
  const styl = { ...good, layer: 'style' };
  t('upstream: style 层不回流', !assess(styl).ok);
  const once = { ...good, occurrences: '1' };
  t('upstream: 只出现一次不回流', !assess(once).ok);
  const open = { ...good, status: 'open' };
  t('upstream: 未落地不回流', !assess(open).ok);
  const compBug = { ...good, root_cause: 'DateRangePicker 的组件 bug：flex 估宽偏窄导致提前换行' };
  t('upstream: 组件问题不回流', !assess(compBug).ok && assess(compBug).reasons.some((x) => x.includes('组件问题')));
  t('upstream: scope=component-bug 不回流', !assess({ ...good, scope: 'component-bug' }).ok);
}

console.log('== learnings');
const real = checkLearnings().results;
for (const r of real.filter((x) => x.level === 'FAIL')) t(`real log: ${r.id}`, false, r.msg);
t(`real log + versions + rule coverage: ${real.length} checks`, real.every((x) => x.level === 'PASS'));
const bad = checkLearnings({ log: join(fx, 'learnings-bad.md') }).results;
const expectViolation = { 'LRN-20261014-91': 'L-01', 'LRN-20261014-92': 'L-02', 'LRN-20261014-93': 'L-03', 'LRN-20261014-94': 'L-04', 'LRN-20261014-95': 'L-05', 'LRN-20261014-96': 'L-01', 'bad-id': 'id 格式' };
for (const [id, code] of Object.entries(expectViolation)) {
  const r = bad.find((x) => x.id === `entry:${id}`);
  t(`learnings-bad: ${id} rejected by ${code}`, r?.level === 'FAIL' && r.msg.includes(code), r ? r.msg : 'entry not found');
}

// 6) CLI contract: --help → 0, missing path → 2, bad fixture → 1, good fixture → 0.
console.log('== CLI contract');
for (const [script, badF, goodF] of [
  ['lint-lobe.mjs', 'tests/fixtures/bad.tsx', 'tests/fixtures/good.tsx'],
  ['check-detail.mjs', 'tests/fixtures/detail-bad.tsx', 'tests/fixtures/detail-good.tsx'],
]) {
  const h = run(script, ['--help']);
  t(`${script} --help → exit 0`, h.status === 0 && /用法/.test(h.stdout), `exit ${h.status}`);
  t(`${script} (no path) → exit 2`, run(script, []).status === 2);
  t(`${script} missing path → exit 2`, run(script, ['nope/does-not-exist.tsx']).status === 2);
  t(`${script} bad fixture → exit 1`, run(script, [badF]).status === 1);
  t(`${script} good fixture → exit 0`, run(script, [goodF]).status === 0);
}
t('check-learnings.mjs --help → exit 0', run('check-learnings.mjs', ['--help']).status === 0);
t('check-learnings.mjs real log → exit 0', run('check-learnings.mjs', []).status === 0);
t('check-learnings.mjs bad log → exit 1', run('check-learnings.mjs', ['--log', 'tests/fixtures/learnings-bad.md']).status === 1);
t('check-learnings.mjs missing log → exit 2', run('check-learnings.mjs', ['--log', 'nope.md']).status === 2);

// 3.0.0 新脚本的 CLI 契约
for (const s of ['refs.mjs', 'intent.mjs', 'bootstrap.mjs', 'upstream.mjs', 'project-scan.mjs']) {
  t(`${s} --help → exit 0`, run(s, ['--help']).status === 0, `exit ${run(s, ['--help']).status}`);
}
t('lint-lobe.mjs 未知 --stage → exit 2', run('lint-lobe.mjs', ['tests/fixtures/bad-visual.tsx', '--stage', '50-visua']).status === 2);
t('lint-lobe.mjs 合法 --stage 照常报 FAIL', run('lint-lobe.mjs', ['tests/fixtures/bad-visual.tsx', '--stage', '50-visual']).status === 1);
t('refs.mjs (no instruction) → exit 2', run('refs.mjs', []).status === 2);
t('intent.mjs (no instruction) → exit 2', run('intent.mjs', []).status === 2);
t('refs.mjs --audit → exit 0', run('refs.mjs', ['--audit']).status === 0);
t('refs.mjs 未知 stage → exit 2', run('refs.mjs', ['随便', '--stage', 'nope']).status === 2);
t('bootstrap.mjs --print 不落盘', run('bootstrap.mjs', ['--print', '--root', '/tmp']).status === 0);
t('bootstrap.mjs --check 未接入 → exit 1', run('bootstrap.mjs', ['--check', '--root', '/tmp']).status === 1);
t('project-scan.mjs --check 缺项目层 → exit 1', run('project-scan.mjs', ['--check', '--root', '/tmp']).status === 1);
t('upstream.mjs missing log → exit 2', run('upstream.mjs', ['--from', 'nope.md']).status === 2);
t('upstream.mjs real log → exit 0', run('upstream.mjs', []).status === 0);

console.log(`\nTOTAL: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

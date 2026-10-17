#!/usr/bin/env node
// lobe-design 项目接入。零依赖。
// Usage: node scripts/bootstrap.mjs [--root <dir>] [--check|--print] [--json]
//
// 把 lobe-design 的入口、触发条件、执行纪律和自迭代规则写进消费方仓库的 AGENTS.md。
// 只维护 <!-- lobe-design:begin --> … <!-- lobe-design:end --> 之间的托管块：
//   · 块不存在 → 追加（已有内容一个字不动）
//   · 块已存在 → 整块替换（幂等；重复运行结果一致）
//   · 文件不存在 → 建立
// 块外的内容从不改写——这是本脚本唯一的硬保证，由 tests 锁住。
// --check 额外 WARN：项目层 .agents/ux/product.md / components.md 缺失或过期（不单独判 FAIL）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_VERSION = readFileSync(join(skillDir, 'SKILL.md'), 'utf8').match(/^version:\s*(\S+)/m)?.[1] ?? '0.0.0';
const REPO = 'https://github.com/lobehub/lobe-design-skill';

export const BEGIN = '<!-- lobe-design:begin · managed by scripts/bootstrap.mjs · 不要手动编辑本块 -->';
export const END = '<!-- lobe-design:end -->';

// 探测顺序见 references/init.md I-01（CONTRIBUTING.md 只给人或 Agent 读，脚本不读）
export const CANDIDATES = ['AGENTS.md', 'CLAUDE.md'];

// 项目层规范（references/init.md I-06）：固定顺序，保证输出确定
export const LOCAL_SKILL = '.agents/skills/lobe-design';
export const UX_DIR = '.agents/ux';
export const UX_FILES = [
  ['product.md', '产品画像：平台、产品类型、用户、核心任务、规则适用性、文案 profile（05-init Round 1）'],
  ['components.md', '组件盘点：薄包装 / 与 lobe-ui 重复 / 业务组件用法（05-init Round 2）'],
  ['lobe-design-rules.md', '项目层规则：skill 没收录的编号（`C-` / `D-` / `K-` / `E-`）按 id 查，不要整份读'],
  ['cases.md', '本项目的实例与判例'],
  ['stack.md', '本项目的技术栈与组件来源'],
  ['audit/', '审查记录'],
];

/** 探测 root 下的安装位置与项目层规范。只看是否存在，不读内容。 */
export function detectContext(root) {
  const localSkill = existsSync(join(root, LOCAL_SKILL));
  const uxRoot = join(root, UX_DIR);
  const ux = existsSync(uxRoot) ? UX_FILES.map(([f]) => f).filter((f) => existsSync(join(uxRoot, f.replace(/\/$/, '')))) : null;
  return { localSkill, ux };
}

/** 轻量检查项目层是否齐全（详细指纹过期见 project-scan.mjs --check）。 */
export function detectProjectLayer(root) {
  const uxRoot = join(root, UX_DIR);
  const product = existsSync(join(uxRoot, 'product.md'));
  const components = existsSync(join(uxRoot, 'components.md'));
  const missing = [];
  if (!product) missing.push(`${UX_DIR}/product.md`);
  if (!components) missing.push(`${UX_DIR}/components.md`);
  const stale = [];
  for (const [name, ok] of [['product.md', product], ['components.md', components]]) {
    if (!ok) continue;
    const text = readFileSync(join(uxRoot, name), 'utf8');
    const m = text.match(/<!--\s*lobe-design-init:\s*version=(\S+)\s+fingerprint=(\S+)\s*-->/);
    if (!m) stale.push(`${name}: 缺少 lobe-design-init 标记`);
    else if (m[1] !== SKILL_VERSION) stale.push(`${name}: skill 版本 ${m[1]} → ${SKILL_VERSION}`);
  }
  return { product, components, missing, stale, ok: missing.length === 0 && stale.length === 0 };
}

function renderInstall(localSkill) {
  return localSkill
    ? `skill 装在本仓库的 \`${LOCAL_SKILL}\`，下面所有命令都相对它执行：

\`\`\`bash
export LOBE_DESIGN="./${LOCAL_SKILL}"
# 改用全局安装时：export LOBE_DESIGN="\${HOME}/.claude/skills/lobe-design"
\`\`\``
    : `skill 装在自己机器上，下面所有命令都相对它执行：

\`\`\`bash
# 按你的安装方式二选一（install.sh 默认装到前者）
export LOBE_DESIGN="\${HOME}/.claude/skills/lobe-design"
# export LOBE_DESIGN="./${LOCAL_SKILL}"
\`\`\``;
}

function renderUx(ux) {
  if (!ux) return '';
  const desc = Object.fromEntries(UX_FILES);
  const lines = ux.map((f) => `- \`${UX_DIR}/${f}\`：${desc[f]}`);
  const hasProduct = ux.includes('product.md');
  const hasComponents = ux.includes('components.md');
  const readFirst = hasProduct || hasComponents
    ? `- **日常任何 UI 任务**：先读 ${[hasProduct && `\`${UX_DIR}/product.md\`` , hasComponents && `\`${UX_DIR}/components.md\``].filter(Boolean).join(' 与 ')}，再按 stage 加载 skill 规则。`
    : `- **日常任何 UI 任务**：若尚未建立项目层，先对 Agent 说「初始化 lobe-design」（05-init 两轮）。`;
  const brief = hasProduct
    ? `- 宏观指令（「整体打磨」「重做这页」）和新页面从 stage \`00-brief\` 开始：先读 \`${UX_DIR}/product.md\`，写出后续 stage 消费的页面简报；纯视觉或文案修正跳过。`
    : `- 宏观指令（「整体打磨」「重做这页」）和新页面从 stage \`00-brief\` 开始，写出后续 stage 消费的页面简报；纯视觉或文案修正跳过。`;
  const initHint = `- **装完或升级 skill 后**：跑 stage \`05-init\`（或说「初始化 / 升级后刷新」）完成两轮自迭代——Round 1 产品画像 → \`${UX_DIR}/product.md\`，Round 2 组件盘点 → \`${UX_DIR}/components.md\`。可用 \`node "$LOBE_DESIGN/scripts/project-scan.mjs" --check\` 检查是否缺失或过期。`;
  return `

### 项目层规范（\`${UX_DIR}/\`）

本项目的事实和补充规则放在 \`${UX_DIR}/\`，与 skill 共存：skill 管通用判据，这里管本项目；冲突时以 skill 为准。**重装 / 升级不会覆盖本目录。**

${lines.join('\n')}
${initHint}
${readFirst}
${brief}`;
}

export function findGuideFile(root) {
  for (const name of CANDIDATES) {
    const p = join(root, name);
    if (existsSync(p)) return { path: p, name, existed: true };
  }
  return { path: join(root, 'AGENTS.md'), name: 'AGENTS.md', existed: false };
}

/** 生成托管块内容（不含首尾 marker）。 */
export function renderBlock(version = SKILL_VERSION, repo = REPO, marker = 'scripts/bootstrap.mjs', ctx = {}) {
  const { localSkill = false, ux = null } = ctx;
  const rulesFile = ux ? `\`${UX_DIR}/lobe-design-rules.md\`` : '项目自己的规则文件（建议 `.agents/ux/lobe-design-rules.md`）';
  const initLine = ux
    ? ''
    : `
> **装完或升级后先初始化**：对 Agent 说「把项目接上 lobe-design」或跑 bootstrap 场景，完成 AGENTS.md 托管块 + 两轮项目层画像（\`.agents/ux/product.md\` / \`components.md\`）。可用 \`node "$LOBE_DESIGN/scripts/project-scan.mjs" --check\` 检查项目层。
`;
  return `## UI 设计工作指南（lobe-design）

本项目在做界面相关工作（新增页面、改交互、调视觉、统一设计系统、还原设计稿、上线前审查）时，
走 **lobe-design** 这条单入口 pipeline。安装：\`${repo}\`（skill 版本 ${version}）。
${initLine}
${renderInstall(localSkill)}${renderUx(ux)}

### 1. 入口与顺序

- 唯一入口是 skill 的 \`SKILL.md\`。**先跑路由器，再按 stage 加载**：
  \`\`\`bash
  node "$LOBE_DESIGN/scripts/route.mjs" "<用户指令原文>"   # 场景 / 颗粒度 / stage 序列
  node "$LOBE_DESIGN/scripts/refs.mjs"  "<用户指令原文>"   # 每个 stage 该读哪些条目
  \`\`\`
- 路由器读取 \`scripts/pipeline.json\`（唯一事实源）。结果是默认值；结合上下文调整时要在输出里说明理由。
- **一次只进一个 stage。** 进入时才读它「只加载」列出的条目，不要一开始就把 references 读完。
- 每个 stage 只回答一个问题。看到别的问题，只记一行 \`遗留 → <stage>\`，不要顺手改。
- 改过代码的 stage，结束前跑 \`node "$LOBE_DESIGN/scripts/lint-lobe.mjs" <改动路径>\`，FAIL 必须修。
- **做界面前先读项目层**（若已有）：\`${UX_DIR}/product.md\`（画像与适用性）、\`${UX_DIR}/components.md\`（用哪个组件）；没有则先跑 05-init。

### 2. 什么时候用

| 触发 | 例子 |
| --- | --- |
| 新建界面 | 做一个控制台列表页、写一个官网落地页 |
| 改已有界面 | 整体打磨一下、把层级理顺、把状态补齐 |
| 统一设计系统 | 各页面风格不一致、token 收敛 |
| 还原设计稿 | 照着这张截图做 |
| 上线前审查 | 能不能上线、验收一下 |
| 初始化 / 升级后刷新 | 把项目接上 lobe-design；升级 skill 后重跑产品画像与组件盘点 |

指令太抽象时（「体验不好」「丑」「难用」），先跑 \`node "$LOBE_DESIGN/scripts/intent.mjs" "<原话>"\`
把它归一化成「改哪里、看到什么算改好了」，再动手；归一化不了就先问，不要猜。

### 3. 自迭代：纠正要沉淀下来

- **何时记**：用户纠正了一次输出；80 审查发现同类问题本轮复发；60 或 lint 扫描发现可机械识别的漂移 ≥ 2 处。
- **在本项目里记**：写进 ${rulesFile}，续编号，删除的编号不复用；新的产品事实写 \`product.md\`，组件用法写 \`components.md\`，一次性决定不记。
  不改 \`$LOBE_DESIGN\` 下的 skill 文件（重装会覆盖），也不在本项目里 bump skill 版本或写 skill 的 \`learnings/LOG.md\`。
- **选层（由强到弱，选当前可行的最强一层）**：\`structure > lint > rule > style\`
  - 能用「出现了 X」「做了 X 却没有 Y」或数数描述 → **lint**
  - 需要看渲染但要判据可写清 → **rule**（编号规则）
  - 只能主观判断 → **style**，且必须写 \`why_not_code\`
  - 同一现象第二次出现必须升层，不能停在 style。
- **通用经验走回流**：去掉项目名之后还成立 → 按第 4 节回流上游；不成立 → 留在项目层。
- **回流落地后（在 skill 仓库里，由维护者执行）**：先写失败用例 → 再写反例 → 加规则（默认 WARN）→ 登记 reference
  → bump 版本 + CHANGELOG → 记账（\`learnings/LOG.md\`）→ \`node tests/run.mjs\` 全绿才算完成。
  lint 落地必须有真实规则 id 和回归样例；landed 必须带版本且 CHANGELOG 有该版本。
- **版本语义**：patch 修误报 · minor 加规则或 WARN 升 FAIL · major 改 stage 或路由、删除编号。删除的编号不复用。

### 4. 把经验回流到上游

通用经验（不依赖本项目品牌与业务）应该回流到 \`${repo}\`，见其 \`CONTRIBUTING.md\`：

- 提之前先自检：去掉项目名之后还成立吗？场景是通用的还是本项目特有的？
- 本地先跑 \`node "$LOBE_DESIGN/scripts/upstream.mjs" --from <你的 learnings/LOG.md>\` 提取候选条目。
- 回流的是**判据**（可机械校验的规则、可复用的 stage 契约），不是本项目的具体取值。

> 本节由 \`${marker}\` 维护。块外内容属于项目自己，不会被本脚本改写。
> 重新运行 \`node "$LOBE_DESIGN/scripts/bootstrap.mjs"\` 可把本块更新到最新版本。`;
}


/** 把托管块插入 / 替换到 fileText，返回 { text, action }。块外内容不变。 */
// 比较托管块内容时只抹平格式化工具（prettier、remark 等）会做的改写：行首尾空白、空行、连续空白、
// 表格单元格两侧的补齐空格与分隔线长度、中点写法（· / ・）、中文与其他字符之间的空格（remark 的中英文间距）。
// 两个 ASCII 字符之间的空白保留：命令里删掉空格仍算漂移。
export function blockMatches(fileText, block) {
  const start = fileText.indexOf(BEGIN);
  const end = fileText.indexOf(END);
  if (start === -1 || end === -1 || end < start) return false;
  const norm = (s) => s.split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' ').replace(/ ?\| ?/g, '|').replace(/-{3,}/g, '---').replace(/ ?[·・] ?/g, '·').replace(/ (?=[^\x00-\x7f])|(?<=[^\x00-\x7f]) /g, ''))
    .filter(Boolean)
    .join('\n');
  return norm(fileText.slice(start + BEGIN.length, end)) === norm(block);
}

export function applyBlock(fileText, block) {
  const managed = `${BEGIN}\n${block}\n${END}`;
  const start = fileText.indexOf(BEGIN);
  const end = fileText.indexOf(END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = fileText.slice(0, start);
    const after = fileText.slice(end + END.length);
    const next = `${before}${managed}${after}`;
    return { text: next, action: next === fileText ? 'unchanged' : 'replaced' };
  }
  const sep = fileText.length === 0 ? '' : fileText.endsWith('\n') ? '\n' : '\n\n';
  return { text: `${fileText}${sep}${managed}\n`, action: 'appended' };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`lobe-design bootstrap — 把入口与自迭代规则写进消费方项目的 AGENTS.md（零依赖）

用法
  node scripts/bootstrap.mjs                    探测并写入托管块（已有内容不动）
  node scripts/bootstrap.mjs --check            只检查，不写；块缺失、版本落后或内容过期 → exit 1；项目层缺失/过期 → WARN
  node scripts/bootstrap.mjs --print            打印将要写入的内容，不落盘
  node scripts/bootstrap.mjs --root <dir>       指定项目根目录（默认当前目录）
  --json                                        JSON 输出

托管块
  只维护 ${BEGIN}
  … ${END} 之间的内容；块外一个字都不改。
  不写 .agents/ux/（项目层由 05-init 两轮维护，见 project-scan.mjs）。

退出码
  0  成功 / 已是最新（项目层 WARN 不改变退出码）
  1  --check 失败（未接入、版本落后或托管块内容过期）
  2  用法错误`);
    process.exit(0);
  }
  const root = args.includes('--root') ? resolve(args[args.indexOf('--root') + 1]) : process.cwd();
  const json = args.includes('--json');
  if (!existsSync(root)) { console.error(`用法错误：目录不存在：${root}`); process.exit(2); }

  const guide = findGuideFile(root);
  const block = renderBlock(SKILL_VERSION, REPO, 'scripts/bootstrap.mjs', detectContext(root));
  const before = guide.existed ? readFileSync(guide.path, 'utf8') : '';
  const { text, action } = applyBlock(before, block);
  const versionLine = before.match(/skill 版本 (\S+?)[）)]/)?.[1];
  const upToDate = action === 'unchanged' && versionLine === SKILL_VERSION;
  const projectLayer = detectProjectLayer(root);

  if (args.includes('--print')) { console.log(block); process.exit(0); }

  if (args.includes('--check')) {
    // --check 的语义是「已接入且托管块最新」：文件不存在、块缺失、版本落后、块内容与当前渲染结果不一致都算没接入。
    // 项目层缺失 / 过期只 WARN，不单独把已接入判成 FAIL（由 project-scan --check 严格查）。
    const blockCurrent = blockMatches(before, block);
    const ok = Boolean(guide.existed) && before.includes(BEGIN) && versionLine === SKILL_VERSION && blockCurrent;
    const out = { root, file: guide.name, existed: guide.existed, action, version: SKILL_VERSION, foundVersion: versionLine ?? null, blockCurrent, ok, projectLayer };
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      if (ok) console.log(`OK  ${guide.name} 已接入（skill ${SKILL_VERSION}，托管块最新）`);
      else if (before.includes(BEGIN) && versionLine === SKILL_VERSION) console.error(`FAIL ${guide.name} 托管块内容已过期（与当前渲染结果不一致，例如项目层变化后未重跑）。运行 node scripts/bootstrap.mjs 修复。`);
      else console.error(`FAIL ${guide.name} 未接入或版本落后（当前 ${versionLine ?? '无托管块'} → ${SKILL_VERSION}）。运行 node scripts/bootstrap.mjs 修复。`);
      if (projectLayer.missing.length) console.warn(`WARN 项目层缺失：${projectLayer.missing.join(', ')}（对 Agent 说「初始化 lobe-design」跑 05-init 两轮）`);
      for (const s of projectLayer.stale) console.warn(`WARN 项目层过期：${s}`);
    }
    process.exit(ok ? 0 : 1);
  }

  if (action !== 'unchanged') {
    mkdirSync(dirname(guide.path), { recursive: true });
    writeFileSync(guide.path, text);
  }
  const result = { root, file: guide.name, action, version: SKILL_VERSION, created: !guide.existed, projectLayer };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${guide.existed ? '更新' : '建立'} ${guide.name}：托管块 ${action}（skill ${SKILL_VERSION}）\n块外内容未改动。`);
    if (projectLayer.missing.length) console.log(`提示：项目层尚未建立（缺 ${projectLayer.missing.join(', ')}）。请让 Agent 跑 05-init 两轮，或 node "$LOBE_DESIGN/scripts/project-scan.mjs" --check。`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

#!/usr/bin/env node
// lobe-design 项目扫描：收集确定性事实，供 05-init 两轮自迭代使用。零依赖。
// Usage: node scripts/project-scan.mjs [--root <dir>] [--check|--print] [--json]
//
// 只读仓库事实，不改任何应用代码，不写 .agents/ux/（由 Agent 按 stage 05 写入）。
// --check：缺 product.md / components.md → exit 1；存在但过期 → exit 0 并 WARN。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { RN_NAV_DEPS, RN_UI_DEPS } from './platform.mjs';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_VERSION = readFileSync(join(skillDir, 'SKILL.md'), 'utf8').match(/^version:\s*(\S+)/m)?.[1] ?? '0.0.0';

export const UX_DIR = '.agents/ux';
export const PRODUCT_FILE = 'product.md';
export const COMPONENTS_FILE = 'components.md';
export const META_BEGIN = '<!-- lobe-design-init:';
export const META_END = ' -->';

/** 框架 / 平台信号：依赖名 → 标签 */
const FRAMEWORK_DEPS = [
  ['next', 'nextjs', 'web'],
  ['nuxt', 'nuxt', 'web'],
  ['@remix-run/react', 'remix', 'web'],
  ['vite', 'vite', 'web'],
  ['react-native', 'react-native', 'mobile'],
  ['expo', 'expo', 'mobile'],
  ['@expo/vector-icons', 'expo', 'mobile'],
  ['electron', 'electron', 'desktop'],
  ['@tauri-apps/api', 'tauri', 'desktop'],
  ['@capacitor/core', 'capacitor', 'mobile'],
  ['@ionic/react', 'ionic', 'mobile'],
];

const UI_DEPS = [
  ...RN_UI_DEPS,
  '@lobehub/ui',
  'antd',
  '@ant-design/pro-components',
  '@mui/material',
  'shadcn',
];

const COMPONENT_DIR_CANDIDATES = [
  'src/components',
  'src/features',
  'src/ui',
  'src/shared/ui',
  'src/shared/components',
  'components',
  'app/components',
  'packages/ui/src',
  'packages/components/src',
];

const ROUTE_DIR_CANDIDATES = [
  'app',
  'src/app',
  'pages',
  'src/pages',
  'src/routes',
  'src/router',
];

function safeRead(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function safeJson(p) {
  const t = safeRead(p);
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function listDirs(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => d.name)
      .sort();
  } catch { return []; }
}

function listFiles(root, rel, max = 40) {
  const abs = join(root, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const out = [];
  const walk = (dir, prefix) => {
    if (out.length >= max) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) break;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const relPath = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), relPath);
      else if (/\.(tsx?|jsx?|vue|svelte)$/.test(e.name)) out.push(relPath);
    }
  };
  walk(abs, '');
  return out.sort();
}

function depsOf(pkg) {
  return {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
    ...(pkg?.peerDependencies ?? {}),
  };
}

/** 从 package.json 与目录结构推断平台与框架（确定性，可复现）。 */
export function detectStack(root) {
  const pkg = safeJson(join(root, 'package.json')) ?? {};
  const all = depsOf(pkg);
  const depNames = Object.keys(all).sort();
  const frameworks = [];
  const platforms = new Set();
  for (const [dep, label, platform] of FRAMEWORK_DEPS) {
    if (all[dep] || depNames.some((n) => n === dep || n.startsWith(`${dep}/`))) {
      if (!frameworks.includes(label)) frameworks.push(label);
      platforms.add(platform);
    }
  }
  // 纯 React web 兜底
  if (all.react && platforms.size === 0) {
    frameworks.push('react');
    platforms.add('web');
  }
  const uiLibs = UI_DEPS.filter((d) => all[d] || depNames.some((n) => n === d || n.startsWith(`${d}/`)));
  const scripts = Object.keys(pkg.scripts ?? {}).sort();
  // 主平台：mobile 信号优先（RN 项目常同时依赖 web 工具链）
  const platform = platforms.has('mobile') ? 'mobile' : platforms.has('desktop') && !platforms.has('web') ? 'desktop' : platforms.size ? 'web' : null;
  const aliases = readAliases(root);
  const rnUi = uiLibs.filter((d) => RN_UI_DEPS.includes(d));
  // 项目内组件库：alias 名是 RN UI 库名（如 @lobehub/ui-rn → src/components），或依赖里有 ui-rn
  for (const [name, target] of Object.entries(aliases)) {
    if (RN_UI_DEPS.includes(name) && !rnUi.includes(name)) rnUi.unshift(name);
  }
  const domUi = uiLibs.filter((d) => !RN_UI_DEPS.includes(d));
  const primaryUi = platform === 'mobile'
    ? (rnUi[0] ? { name: rnUi[0], alias: aliases[rnUi[0]] ?? null, role: 'RN 原子层' } : null)
    : (domUi[0] ? { name: domUi[0], alias: null, role: '原子层' } : null);
  return {
    name: pkg.name ?? null,
    description: pkg.description ?? null,
    frameworks,
    platforms: [...platforms].sort(),
    platform,
    uiLibs: platform === 'mobile' ? [...new Set([...rnUi, ...uiLibs])] : uiLibs,
    primaryUi,
    // mobile 上 DOM 组件库（@lobehub/ui / antd）只是依赖，不是 RN 界面库
    depOnlyUi: platform === 'mobile' ? domUi : [],
    navigation: RN_NAV_DEPS.filter((d) => all[d]),
    aliases,
    scripts,
    hasTypeScript: existsSync(join(root, 'tsconfig.json')) || depNames.includes('typescript'),
  };
}

/** tsconfig / jsconfig 的 paths：{ '@lobehub/ui-rn': 'src/components' }（去掉 /* 与 ./）。 */
export function readAliases(root) {
  const out = {};
  for (const f of ['tsconfig.json', 'jsconfig.json']) {
    const t = safeRead(join(root, f));
    if (!t) continue;
    let cfg;
    try { cfg = JSON.parse(t.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); } catch { continue; }
    for (const [k, v] of Object.entries(cfg?.compilerOptions?.paths ?? {})) {
      const name = k.replace(/\/\*$/, '');
      const target = String(Array.isArray(v) ? v[0] : v).replace(/\/\*$/, '').replace(/^\.\//, '').replace(/\/index\.[jt]sx?$/, '');
      if (name && target) out[name] = target;
    }
  }
  return out;
}

// ---- Round 2 组件分类（平台感知）----
export const COMPONENT_SCHEMES = {
  web: ['薄包装', '与 lobe-ui 重复', '业务组件'],
  mobile: ['项目原子层', '薄包装', '业务组件'],
};
const ATOM_NAME = /^\s*export\s+(?:default\s+)?(?:const|function)\s+(Button|Modal|Drawer|Table|Input|TextInput|Select|Checkbox|Radio|Switch|Tabs|Tooltip|Popover|Tag|Badge|Avatar|Skeleton|Divider|Progress|Spin|Empty|Text|Icon|ActionIcon|Sheet|BottomSheet|Toast|Card|List|ListItem|Flexbox|Center)\b/m;
const RN_PRIMITIVE = /from\s*['"]react-native['"]/;
const importsFrom = (text, names) => names.some((n) => new RegExp(`from\\s*['"]${n.replace(/[/.]/g, (c) => `\\${c}`)}(?:/[^'"]*)?['"]`).test(text));

/** 单文件分类。platform = 'mobile' 时用「项目原子层 / 薄包装 / 业务组件」，不出现「改用 lobe-ui」。 */
export function classifyComponent(rel, text, stack) {
  const mobile = stack.platform === 'mobile';
  const body = text.split('\n').filter((l) => l.trim() && !/^\s*(import|\/\/|\*|\/\*)/.test(l));
  const ui = mobile ? [stack.primaryUi?.name, ...Object.keys(stack.aliases ?? {}).filter((a) => a === stack.primaryUi?.name)].filter(Boolean) : ['@lobehub/ui'];
  const atomDir = mobile ? stack.primaryUi?.alias : null;
  const inAtomDir = !!atomDir && (`${rel}/`).startsWith(`${atomDir}/`);
  const thin = body.length <= 12 && importsFrom(text, ui) && !(mobile && RN_PRIMITIVE.test(text));
  if (thin) return '薄包装';
  if (mobile) {
    if (inAtomDir || (ATOM_NAME.test(text) && RN_PRIMITIVE.test(text) && !/features?\//.test(rel))) return '项目原子层';
    return '业务组件';
  }
  if (ATOM_NAME.test(text) && !importsFrom(text, ui)) return '与 lobe-ui 重复';
  return '业务组件';
}

export function classifyComponents(root, stack, dirs, max = 80) {
  const seen = new Set(), out = [];
  for (const d of dirs) for (const f of listFiles(root, d.dir, 50)) {
    const rel = `${d.dir}/${f}`;
    if (seen.has(rel) || out.length >= max) continue;
    seen.add(rel);
    const text = safeRead(join(root, rel)) ?? '';
    out.push({ file: rel, class: classifyComponent(rel, text, stack) });
  }
  return out;
}

export function detectRoutes(root) {
  const found = [];
  for (const rel of ROUTE_DIR_CANDIDATES) {
    if (!existsSync(join(root, rel))) continue;
    const kids = listDirs(root, rel).slice(0, 30);
    const files = listFiles(root, rel, 20);
    found.push({ dir: rel, subdirs: kids, sampleFiles: files.slice(0, 15) });
  }
  return found;
}

export function detectComponentDirs(root) {
  const found = [];
  for (const rel of COMPONENT_DIR_CANDIDATES) {
    if (!existsSync(join(root, rel))) continue;
    const files = listFiles(root, rel, 50);
    found.push({
      dir: rel,
      fileCount: files.length,
      sampleFiles: files.slice(0, 20),
    });
  }
  // 额外：src 下带 components 的一级子目录
  const src = join(root, 'src');
  if (existsSync(src) && statSync(src).isDirectory()) {
    for (const name of listDirs(root, 'src')) {
      const rel = `src/${name}/components`;
      if (COMPONENT_DIR_CANDIDATES.includes(rel)) continue;
      if (!existsSync(join(root, rel))) continue;
      const files = listFiles(root, rel, 30);
      found.push({ dir: rel, fileCount: files.length, sampleFiles: files.slice(0, 15) });
    }
  }
  return found;
}

export function detectDocs(root) {
  const readme = ['README.md', 'readme.md', 'README.zh-CN.md', 'README.zh.md']
    .map((f) => join(root, f))
    .find((p) => existsSync(p));
  let readmeTitle = null;
  let readmeLead = null;
  if (readme) {
    const t = safeRead(readme) ?? '';
    readmeTitle = t.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
    const paras = t.split(/\n\n+/).map((p) => p.replace(/\n/g, ' ').trim()).filter((p) => p && !p.startsWith('#') && !p.startsWith('<') && !p.startsWith('[!'));
    readmeLead = paras[0]?.slice(0, 240) ?? null;
  }
  const i18nDirs = ['locales', 'src/locales', 'apps/desktop/locales', 'messages', 'src/i18n']
    .filter((d) => existsSync(join(root, d)));
  const docsDirs = ['docs', 'documentation', '.agents/ux']
    .filter((d) => existsSync(join(root, d)));
  return {
    readme: readme ? relative(root, readme) : null,
    readmeTitle,
    readmeLead,
    i18nDirs,
    docsDirs,
  };
}

/** 解析产品层文件头里的 init meta（skill 版本 + 指纹）。 */
export function parseInitMeta(text) {
  if (!text) return null;
  const m = text.match(/<!--\s*lobe-design-init:\s*version=(\S+)\s+fingerprint=(\S+)\s*-->/);
  if (!m) return null;
  return { version: m[1], fingerprint: m[2] };
}

export function renderInitMeta(version, fingerprint) {
  return `${META_BEGIN} version=${version} fingerprint=${fingerprint}${META_END}`;
}

/** 对扫描事实做短指纹，供过期检测。 */
export function fingerprintOf(facts) {
  const slim = {
    name: facts.stack?.name,
    frameworks: facts.stack?.frameworks,
    platforms: facts.stack?.platforms,
    uiLibs: facts.stack?.uiLibs,
    componentDirs: (facts.components ?? []).map((c) => [c.dir, c.fileCount]),
    routeDirs: (facts.routes ?? []).map((r) => r.dir),
    i18n: facts.docs?.i18nDirs,
  };
  return createHash('sha256').update(JSON.stringify(slim)).digest('hex').slice(0, 12);
}

export function scanProject(root) {
  const stack = detectStack(root);
  const routes = detectRoutes(root);
  const components = detectComponentDirs(root);
  const docs = detectDocs(root);
  const uxRoot = join(root, UX_DIR);
  const ux = {
    exists: existsSync(uxRoot),
    product: existsSync(join(uxRoot, PRODUCT_FILE)),
    components: existsSync(join(uxRoot, COMPONENTS_FILE)),
    rules: existsSync(join(uxRoot, 'lobe-design-rules.md')),
    stack: existsSync(join(uxRoot, 'stack.md')),
  };
  const productText = ux.product ? safeRead(join(uxRoot, PRODUCT_FILE)) : null;
  const componentsText = ux.components ? safeRead(join(uxRoot, COMPONENTS_FILE)) : null;
  const scheme = COMPONENT_SCHEMES[stack.platform === 'mobile' ? 'mobile' : 'web'];
  const componentClasses = classifyComponents(root, stack, components);
  const facts = { root, skillVersion: SKILL_VERSION, stack, routes, components, componentScheme: scheme, componentClasses, docs, ux };
  const fingerprint = fingerprintOf(facts);
  facts.fingerprint = fingerprint;
  facts.productMeta = parseInitMeta(productText);
  facts.componentsMeta = parseInitMeta(componentsText);
  return facts;
}

/** 项目层是否齐全 / 是否过期。 */
export function assessProjectLayer(facts) {
  const missing = [];
  if (!facts.ux.product) missing.push(`${UX_DIR}/${PRODUCT_FILE}`);
  if (!facts.ux.components) missing.push(`${UX_DIR}/${COMPONENTS_FILE}`);
  const stale = [];
  const checkMeta = (label, meta) => {
    if (!meta) {
      stale.push(`${label}: 缺少 ${META_BEGIN.trim()} 标记`);
      return;
    }
    if (meta.version !== facts.skillVersion) stale.push(`${label}: skill 版本 ${meta.version} → ${facts.skillVersion}`);
    if (meta.fingerprint !== facts.fingerprint) stale.push(`${label}: 指纹 ${meta.fingerprint} → ${facts.fingerprint}`);
  };
  if (facts.ux.product) checkMeta(PRODUCT_FILE, facts.productMeta);
  if (facts.ux.components) checkMeta(COMPONENTS_FILE, facts.componentsMeta);
  return {
    ok: missing.length === 0 && stale.length === 0,
    missing,
    stale,
    fingerprint: facts.fingerprint,
    skillVersion: facts.skillVersion,
  };
}

function renderHuman(facts) {
  const lines = [];
  lines.push(`lobe-design project-scan · skill ${facts.skillVersion} · fingerprint ${facts.fingerprint}`);
  lines.push('');
  lines.push(`包名：${facts.stack.name ?? '（无 package.json name）'}`);
  if (facts.stack.description) lines.push(`描述：${facts.stack.description}`);
  lines.push(`平台：${facts.stack.platforms.join(', ') || '未判定'}`);
  lines.push(`框架：${facts.stack.frameworks.join(', ') || '未判定'}`);
  const pu = facts.stack.primaryUi;
  lines.push(`UI 库：${pu ? `${pu.name}${pu.alias ? `（alias → ${pu.alias}）` : ''} · ${pu.role}` : facts.stack.uiLibs.join(', ') || '未发现'}`);
  const others = facts.stack.uiLibs.filter((d) => d !== pu?.name && !facts.stack.depOnlyUi.includes(d));
  if (others.length) lines.push(`  其他 UI 依赖：${others.join(', ')}`);
  if (facts.stack.depOnlyUi.length) lines.push(`  仅依赖、不是 RN 界面库：${facts.stack.depOnlyUi.join(', ')}（DOM 组件库，RN 界面不从这里取原子层）`);
  if (facts.stack.navigation.length) lines.push(`导航：${facts.stack.navigation.join(', ')}`);
  lines.push(`TypeScript：${facts.stack.hasTypeScript ? '是' : '否'}`);
  if (facts.docs.readmeTitle) lines.push(`README：${facts.docs.readmeTitle}`);
  if (facts.docs.readmeLead) lines.push(`  ${facts.docs.readmeLead}`);
  if (facts.docs.i18nDirs.length) lines.push(`i18n：${facts.docs.i18nDirs.join(', ')}`);
  lines.push('');
  lines.push('路由目录：');
  if (!facts.routes.length) lines.push('  （未发现常见 app/pages/routes）');
  for (const r of facts.routes) {
    lines.push(`  ${r.dir}/  子目录 ${r.subdirs.slice(0, 8).join(', ') || '—'}`);
  }
  lines.push('');
  lines.push('组件目录：');
  if (!facts.components.length) lines.push('  （未发现常见 components/features）');
  for (const c of facts.components) {
    lines.push(`  ${c.dir}/  ~${c.fileCount} 文件`);
    if (c.sampleFiles.length) lines.push(`    样例：${c.sampleFiles.slice(0, 6).join(', ')}`);
  }
  if (facts.componentClasses.length) {
    const count = Object.fromEntries(facts.componentScheme.map((c) => [c, facts.componentClasses.filter((x) => x.class === c).length]));
    lines.push(`组件初分（启发式，Round 2 复核）：${facts.componentScheme.map((c) => `${c} ${count[c]}`).join(' · ')}`);
  }
  lines.push('');
  lines.push('项目层：');
  lines.push(`  ${UX_DIR}/${PRODUCT_FILE}：${facts.ux.product ? '有' : '缺'}`);
  lines.push(`  ${UX_DIR}/${COMPONENTS_FILE}：${facts.ux.components ? '有' : '缺'}`);
  lines.push('');
  lines.push('下一步（由 Agent 执行，本脚本不落盘）：');
  lines.push('  Round 1 → 写/更新 .agents/ux/product.md（平台、产品类型、用户、核心任务、适用性、copy-profile）');
  lines.push(`  Round 2 → 写/更新 .agents/ux/components.md（${facts.componentScheme.join(' / ')}）${facts.stack.platform === 'mobile' ? '；mobile：项目组件库就是原子层，不要求改用 @lobehub/ui' : ''}`);
  lines.push(`  文件头写入：${renderInitMeta(facts.skillVersion, facts.fingerprint)}`);
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`lobe-design project-scan — 收集宿主项目的确定性事实（零依赖，只读）

用法
  node scripts/project-scan.mjs                 扫描当前目录，人读输出
  node scripts/project-scan.mjs --json          JSON 输出
  node scripts/project-scan.mjs --print         同默认（显式）
  node scripts/project-scan.mjs --check         检查项目层：缺文件 → exit 1；过期 → WARN + exit 0
  node scripts/project-scan.mjs --root <dir>    指定项目根

不写任何文件。Agent 按 stages/05-init.md 两轮把结果写入 .agents/ux/。

退出码
  0  成功 / --check 文件齐全（过期只 WARN）
  1  --check 缺 product.md 或 components.md
  2  用法错误`);
    process.exit(0);
  }
  const root = args.includes('--root') ? resolve(args[args.indexOf('--root') + 1]) : process.cwd();
  const json = args.includes('--json');
  if (!existsSync(root)) { console.error(`用法错误：目录不存在：${root}`); process.exit(2); }

  const facts = scanProject(root);
  const assessment = assessProjectLayer(facts);

  if (args.includes('--check')) {
    const out = { ...assessment, root, ux: facts.ux };
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      if (assessment.missing.length) {
        console.error(`FAIL 项目层缺失：${assessment.missing.join(', ')}`);
        console.error(`     对 Agent 说「初始化 lobe-design」或跑 bootstrap 场景（05-init 两轮）。`);
      } else {
        console.log(`OK   项目层齐全（${UX_DIR}/${PRODUCT_FILE} · ${UX_DIR}/${COMPONENTS_FILE}）`);
      }
      for (const s of assessment.stale) console.warn(`WARN 过期：${s}`);
      if (!assessment.missing.length && assessment.stale.length) {
        console.warn(`     建议重跑 05-init（升级后或仓库结构变化后）。`);
      }
    }
    process.exit(assessment.missing.length ? 1 : 0);
  }

  if (json) {
    console.log(JSON.stringify({ ...facts, assessment }, null, 2));
  } else {
    console.log(renderHuman(facts));
    if (assessment.missing.length || assessment.stale.length) {
      console.log('');
      if (assessment.missing.length) console.log(`状态：缺 ${assessment.missing.join(', ')}`);
      if (assessment.stale.length) console.log(`状态：过期 — ${assessment.stale.join('；')}`);
    } else {
      console.log('\n状态：项目层齐全且指纹匹配');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

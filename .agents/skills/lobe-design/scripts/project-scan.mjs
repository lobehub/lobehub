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
    // 按名字排序再截断：样本进指纹，不能依赖文件系统的 readdir 顺序
    try { entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); } catch { return; }
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

// 不设上限地列出源码文件：样本有上限，但指纹要靠全量的数量与相对路径才能发现增删和改名
function allFiles(root, rel) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const relPath = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), relPath);
      else if (/\.(tsx?|jsx?|vue|svelte)$/.test(e.name)) out.push(relPath);
    }
  };
  walk(join(root, rel), '');
  return out.sort();
}
const fileFacts = (root, rel) => {
  const all = allFiles(root, rel);
  return { fileCount: all.length, filesHash: createHash('sha256').update(all.join('\n')).digest('hex').slice(0, 12) };
};

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
  return {
    name: pkg.name ?? null,
    description: pkg.description ?? null,
    frameworks,
    platforms: [...platforms].sort(),
    uiLibs,
    scripts,
    hasTypeScript: existsSync(join(root, 'tsconfig.json')) || depNames.includes('typescript'),
  };
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
      ...fileFacts(root, rel),
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
      found.push({ dir: rel, ...fileFacts(root, rel), sampleFiles: files.slice(0, 15) });
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
    // 带上全量文件路径的哈希与路由子目录：文件数不变的改名 / 替换也要让指纹变化
    componentDirs: (facts.components ?? []).map((c) => [c.dir, c.fileCount, c.filesHash]),
    routeDirs: (facts.routes ?? []).map((r) => [r.dir, r.subdirs]),
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
  const facts = { root, skillVersion: SKILL_VERSION, stack, routes, components, docs, ux };
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
  lines.push(`UI 库：${facts.stack.uiLibs.join(', ') || '未发现'}`);
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
  lines.push('');
  lines.push('项目层：');
  lines.push(`  ${UX_DIR}/${PRODUCT_FILE}：${facts.ux.product ? '有' : '缺'}`);
  lines.push(`  ${UX_DIR}/${COMPONENTS_FILE}：${facts.ux.components ? '有' : '缺'}`);
  lines.push('');
  lines.push('下一步（由 Agent 执行，本脚本不落盘）：');
  lines.push('  Round 1 → 写/更新 .agents/ux/product.md（平台、产品类型、用户、核心任务、适用性、copy-profile）');
  lines.push('  Round 2 → 写/更新 .agents/ux/components.md（薄包装 / 重复 / 业务组件用法）');
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

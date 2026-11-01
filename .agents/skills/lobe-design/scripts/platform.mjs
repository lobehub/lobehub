// lobe-design 平台与项目层适用性：lint / bootstrap / project-scan 共用。零依赖。
// 平台来源（由强到弱）：显式参数 → .agents/ux/product.md 的「平台：」行 → package.json 依赖。
// 适用性：product.md 里标「不适用 / N/A」的规则编号（C-01、C-01..C-11）或 lint id（LOBE-XXX），
// 以及显式的 `lint-off: LOBE-XXX, D-01` 行，都会让 lint 跳过对应规则（项目层优先于通用规则）。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const PLATFORMS = ['web', 'desktop', 'mobile'];
export const MOBILE_DEPS = ['react-native', 'expo', '@lobehub/ui-rn', '@capacitor/core', '@ionic/react'];
export const RN_UI_DEPS = ['@lobehub/ui-rn', 'react-native-paper', 'tamagui', '@rneui/themed', 'native-base', '@gluestack-ui/themed', 'react-native-ui-lib'];
export const RN_NAV_DEPS = ['expo-router', '@react-navigation/native', '@react-navigation/native-stack', '@react-navigation/bottom-tabs', '@react-navigation/stack', '@react-navigation/drawer'];

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const json = (p) => { const t = read(p); if (!t) return null; try { return JSON.parse(t); } catch { return null; } };
export const depsOf = (pkg) => ({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.peerDependencies ?? {}) });
const hasDep = (all, d) => Object.keys(all).some((n) => n === d || n.startsWith(`${d}/`));

/** 从 product.md 文本读平台（「平台：mobile」「platform: mobile, web」「| 平台 | mobile |」）。 */
export function parsePlatform(text) {
  if (!text) return null;
  const m = text.match(/^[\s>*|-]*(?:\*\*)?(?:平台|platform)(?:\*\*)?\s*(?:[:：]|\|)\s*`?([^\n`|]+)/im);
  if (!m) return null;
  const found = PLATFORMS.filter((p) => new RegExp(`\\b${p}\\b`, 'i').test(m[1]));
  if (/\bmix\b/i.test(m[1]) && !found.length) return 'mix';
  if (!found.length) return null;
  // 多选时第一个出现的为主平台
  return found.sort((a, b) => m[1].toLowerCase().indexOf(a) - m[1].toLowerCase().indexOf(b))[0];
}

/** 从依赖推断平台：react-native / expo / ui-rn → mobile。 */
export function platformFromDeps(all) {
  if (MOBILE_DEPS.some((d) => hasDep(all, d))) return 'mobile';
  if (['electron', '@tauri-apps/api'].some((d) => hasDep(all, d))) return 'desktop';
  if (Object.keys(all).length) return 'web';
  return null;
}

const ID = '[A-Z]{1,2}-\\d{2}';
/** 展开 C-01..C-11 / C-01~C-11 / C-01–C-11 区间。 */
function expandIds(s) {
  const out = new Set();
  for (const m of s.matchAll(new RegExp(`(${ID})\\s*(?:\\.\\.|~|–|—|到)\\s*(${ID})`, 'g'))) {
    const [p1, n1] = m[1].split('-'), [p2, n2] = m[2].split('-');
    if (p1 !== p2) continue;
    for (let i = +n1; i <= +n2; i++) out.add(`${p1}-${String(i).padStart(2, '0')}`);
  }
  for (const m of s.matchAll(new RegExp(`\\b${ID}\\b`, 'g'))) out.add(m[0]);
  for (const m of s.matchAll(/\bLOBE-[A-Z0-9-]+\b/g)) out.add(m[0]);
  return out;
}

const NA = /不适用|n\/a|not applicable|关闭|停用/i;
/** 读项目层的适用性：返回被标为不适用的规则编号 / lint id。 */
export function parseApplicability(text) {
  const off = new Set();
  if (!text) return off;
  for (const line of text.split('\n')) {
    const lo = line.match(/lint-off\s*[:：]\s*`?([^`\n]+)/i);
    if (lo) { for (const id of expandIds(lo[1])) off.add(id); continue; }
    if (!NA.test(line)) continue;
    // 表格行：只看标「不适用」的那一行；普通行：只看「不适用」前后同一句
    for (const id of expandIds(line)) off.add(id);
  }
  return off;
}

/** glob → RegExp（相对项目根的 posix 路径）：** 跨目录，* 与 ? 不跨 /；以 / 结尾视为整个目录。 */
export function globToRe(g) {
  let x = g.trim().replace(/^\.\//, '');
  if (x.endsWith('/')) x += '**';
  let re = '';
  for (let i = 0; i < x.length; i++) {
    const c = x[i];
    if (c === '*' && x[i + 1] === '*') { i++; if (x[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const RULE_TOKEN = /^(?:LOBE-[A-Z0-9-]+|[A-Z]{1,2}-\d{2})$/;
/** `lint-allow: LOBE-RN-DOM-UI src/hooks/**, src/styles/**`（可多行）→ [{ rules, globs }]。没有规则 id 的行忽略。 */
export function parseAllow(text) {
  const out = [];
  for (const m of (text ?? '').matchAll(/lint-allow\s*[:：]\s*`?([^`\n]+)/gi)) {
    const toks = m[1].split(/[\s,，]+/).filter(Boolean);
    const rules = toks.filter((t) => RULE_TOKEN.test(t)), globs = toks.filter((t) => !RULE_TOKEN.test(t));
    if (rules.length && globs.length) out.push({ rules, globs: globs.map(globToRe), raw: m[1].trim() });
  }
  return out;
}

/** 从 start 向上找项目根（有 package.json 或 .agents/ux 的最近目录）。 */
export function findProjectRoot(start) {
  let d = resolve(start);
  try { if (!statSync(d).isDirectory()) d = dirname(d); } catch { return null; }
  for (;;) {
    if (existsSync(join(d, '.agents', 'ux', 'product.md')) || existsSync(join(d, 'package.json'))) return d;
    if (existsSync(join(d, '.git'))) return null; // 不越过仓库边界
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** 项目上下文：{ root, platform, source, off:Set, uiLibs } */
export function projectContext(root, { platform } = {}) {
  const product = root ? read(join(root, '.agents', 'ux', 'product.md')) : null;
  const all = root ? depsOf(json(join(root, 'package.json'))) : {};
  let source = 'default';
  let p = platform && platform !== 'auto' ? (source = 'flag', platform) : null;
  if (!p) { const x = parsePlatform(product); if (x) { p = x; source = 'product.md'; } }
  if (!p) { const x = platformFromDeps(all); if (x) { p = x; source = 'package.json'; } }
  if (p === 'mix') p = platformFromDeps(all) ?? 'web';
  return { root, platform: p ?? 'web', source, off: parseApplicability(product), allow: parseAllow(product), rnUi: RN_UI_DEPS.filter((d) => hasDep(all, d)) };
}

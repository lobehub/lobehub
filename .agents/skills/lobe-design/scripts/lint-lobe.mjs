#!/usr/bin/env node
// lobe-design static lint. Zero dependencies.
// Usage: node scripts/lint-lobe.mjs <path...> [--json] [--rules]
// Exit 1 when any FAIL. Suppress a finding with a comment on the same or previous line:
//   // lobe-design-ignore LOBE-RAW-COLOR: <reason>
// Every rule names the reference rule it enforces, so a finding routes to exactly one stage.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProjectRoot, projectContext } from './platform.mjs';

// lobe-ui 应用不依赖 antd / antd-style：组件与样式 API 都从 @lobehub/ui 取。
const ANTD_SOURCE = /^(?:antd|antd-style)(?:\/[^'"]*)?$/;
// 平台作用域：每条规则声明 platforms（缺省 = 全平台）。web 专属的是 CSS / DOM / lobe-ui(DOM) / antd 相关检查；
// RN / mobile 项目跳过它们（见 scripts/platform.mjs 与 references/init.md I-10）。
export const WEB = ['web', 'desktop'];
export const ALL = ['web', 'desktop', 'mobile'];
// LOBE-RN-DOM-UI（5.6.0）：只报「组件导入」——从组件入口导入 PascalCase 名字（具名 / 默认 / 命名空间）。
// 平台无关的工具（hooks、Markdown 插件、styles / 颜色种子、utils、types、locale）不报：RN 复用它们是正当的。
const DOM_UI_SRC = /^(?:@lobehub\/ui|antd)(?:\/(.*))?$/;
const DOM_UTIL_SEG = /^(?:hooks?|utils?|plugins?|styles?|types?|locales?|i18n|helpers?|constants?|theme|colou?rs?|seeds?|interface|const|tokens?)$|^use[A-Z]|\.(?:css|less|json)$/;
const DOM_UI_ENTRIES = new Set(['form', 'pro-table', 'dashboard', 'mobile', 'awesome', 'chat', 'icons', 'base-ui', 'mdx', 'brand']);
const isPascal = (n) => /^[A-Z][A-Za-z0-9]*$/.test(n);
export function isDomComponentImport(src, clause) {
  const m = src.match(DOM_UI_SRC);
  if (!m || !clause?.trim()) return false; // 副作用导入（css）不算组件
  const segs = (m[1] ?? '').split('/').filter(Boolean);
  const rest = /^(?:es|lib|esm|cjs)$/.test(segs[0] ?? '') ? segs.slice(1) : segs;
  if (rest.some((x) => DOM_UTIL_SEG.test(x))) return false;
  // 子路径必须是组件入口：已知入口（form / pro-table…）或 es/<PascalCase>[/index]
  if (rest.length && !(DOM_UI_ENTRIES.has(rest[0]) || (isPascal(rest[0]) && rest.slice(1).every((x) => x === 'index'))) ) return false;
  const named = clause.match(/\{([^}]*)\}/)?.[1] ?? '';
  const head = clause.replace(/\{[^}]*\}/, '').split(',').map((x) => x.trim()).filter(Boolean);
  if (head.some((h) => /^\*\s+as\s+/.test(h) || isPascal(h))) return true; // 默认 / 命名空间
  return named.split(',').map((x) => x.trim()).filter((x) => x && !/^type\s/.test(x)).some((x) => { const n = x.split(/\s+as\s+/)[0]; return n === 'default' || isPascal(n); });
}

const PURPLE_NAMES = /\b(purple|violet|indigo|fuchsia)\b/i;

function hexHue(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  h = h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  const l = (max + min) / 2;
  const sat = d / (1 - Math.abs(2 * l - 1));
  return { hue, sat };
}
// Return JSX opening tags, respecting {...} nesting so nested <Icon /> does not end the tag.
function openTags(text, re) {
  const out = [];
  for (const m of text.matchAll(re)) {
    let depth = 0, i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const tag = text.slice(m.index, i + 1);
    out.push({ index: m.index, tag, end: i + 1, selfClosing: tag.endsWith('/>') });
  }
  return out;
}
const isPurpleish = (hex) => { const { hue, sat } = hexHue(hex); return hue >= 230 && hue <= 300 && sat > 0.35; };

// ---- 75-copy（T-02 / T-03）：只看含中文的用户可见字符串 ----
// 片段来源：'…' / "…" / `…` 字面量与 JSX 文本（>…<）。去掉 ${…}、{{…}}、{…} 插值、URL 与 `code` 后再判断，
// 所以 `${n}个`、`{count}条` 这类插值边界不报（宁可漏报，不误报）。
const CJK = '\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff';
const HAS_CJK = new RegExp(`[${CJK}]`);
const CJK_LATIN = new RegExp(`[${CJK}][A-Za-z0-9]|[A-Za-z0-9][${CJK}]`);
const HALF_PUNCT = new RegExp(`[${CJK}][,;:!?](?=[${CJK}]|\\s*$)`);
function copySegments(line) {
  const segs = [];
  for (const m of line.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`|>([^<>{}]+)</g)) segs.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return segs
    .filter((s) => s && HAS_CJK.test(s))
    .map((s) => s.replace(/\$\{[^}]*\}|\{\{[^}]*\}\}|\{[^}]*\}|https?:\/\/\S+|<[^>]*>/g, ' '));
}
const copyHit = (re) => (l) => !/^\s*import\b/.test(l) && copySegments(l).some((s) => re.test(s));

// kind 'line': test(line) per non-comment line. kind 'text': test(text) returns [{index, match}].
// LOBE-FONT-FAMILY：值来自主题 token（cssVar / token）或只是继承（inherit / unset / initial / revert）时不报；
// 三元表达式逐个分支判断，undefined / null 分支视为「不设置」。
const FONT_OK = /^(?:\$\{\s*)?(?:cssVar|token|theme)\.[\w.]+\}?$|^['"]?(?:inherit|unset|initial|revert)['"]?$|^(?:undefined|null)$/;
function fontFamilyViolation(l) {
  const m = l.match(/font-family\s*:\s*([^;\n]+)/) || l.match(/fontFamily\s*:\s*([^,}\n]+)/);
  if (!m) return false;
  const branches = m[1].trim().replace(/\s*\*\/.*$/, '').split(/\s[?:]\s/).slice(m[1].includes('?') ? 1 : 0);
  return !branches.every((b) => FONT_OK.test(b.trim().replace(/[;,]$/, '')));
}

// LOBE-OUTLINE-NONE：只在可能被键盘聚焦的元素上报。看所在样式块（css`` 模板，或前后 12 行）：
// - 块里是不可聚焦的 SVG 图形（path / Geography 等）且没有 tabIndex、交互元素时，不报；
// - 块里有 :focus-visible / focus 态的可见替代（box-shadow、border、非 none 的 outline）时，不报。
const OUTLINE_RE = /outline\s*:\s*['"]?(none|0)\b/;
const OUTLINE_SVG = /<(?:path|svg|g|polygon|polyline|circle|ellipse|rect|line)\b|<Geograph(?:y|ies)\b|geograph|(?:^|[\s,&>])(?:path|svg|polygon|polyline|circle|ellipse)\s*(?:[{,:]|$)|pointer-?events\s*:\s*['"]?none/im;
const OUTLINE_FOCUSABLE = /<(?:button|a|input|select|textarea|summary)\b|tab-?index|contenteditable|role=\s*[{'"]*(?:button|link|tab|menuitem|checkbox|radio|switch|option)/i;
const OUTLINE_ALT = /(?:box-shadow|boxShadow|outline-offset|outlineOffset|border(?:-color|Color)?\s*:|outline\s*:\s*(?!['"]?(?:none|0)\b)[^;,\n]+)/;
function outlineContext(lines, i) {
  let a = i, b = i;
  for (let k = i; k >= Math.max(0, i - 12); k--) { a = k; if (k < i && lines[k].includes('`')) break; }
  for (let k = i; k <= Math.min(lines.length - 1, i + 12); k++) { b = k; if (k > i && lines[k].includes('`')) break; }
  return lines.slice(a, b + 1).join('\n');
}
function outlineNoneHits(text) {
  const lines = text.split('\n');
  const out = [];
  let offset = 0;
  lines.forEach((l, i) => {
    const start = offset;
    offset += l.length + 1;
    if (!OUTLINE_RE.test(l) || /^\s*(\/\/|\/\*|\*)/.test(l)) return;
    const ctx = outlineContext(lines, i);
    if (OUTLINE_SVG.test(ctx) && !OUTLINE_FOCUSABLE.test(ctx)) return;
    if (/focus/i.test(ctx) && OUTLINE_ALT.test(ctx.split('\n').filter((x) => !OUTLINE_RE.test(x)).join('\n'))) return;
    out.push({ index: start + l.search(OUTLINE_RE), match: l });
  });
  return out;
}

export const RULES = [
  // ---- 30-structure (C-/D-01/K-10) ----
  { id: 'LOBE-ANTD-IMPORT', platforms: WEB, level: 'FAIL', ref: 'C-01', stage: '30-structure', kind: 'text',
    msg: 'lobe-ui 应用不用 antd / antd-style：组件从 @lobehub/ui 导入（提示用 toast），createStaticStyles / cssVar / cx / useTheme 也从 @lobehub/ui 导入',
    test: (t) => [...t.matchAll(/import\s+(?:type\s+)?[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g)]
      .filter((m) => ANTD_SOURCE.test(m[1]))
      .map((m) => ({ index: m.index, match: m[0].replace(/\s+/g, ' ') })) },
  { id: 'LOBE-FORM-ENTRY', platforms: WEB, level: 'FAIL', ref: 'C-02', stage: '30-structure', kind: 'text',
    msg: 'Form 从 @lobehub/ui/form 导入（根入口的 Form 不带校验）',
    test: (t) => [...t.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@lobehub\/ui['"]/g)]
      .filter((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).includes('Form'))
      .map((m) => ({ index: m.index, match: m[0].replace(/\s+/g, ' ') })) },
  { id: 'LOBE-ANT-ICONS', platforms: WEB, level: 'FAIL', ref: 'C-01', stage: '30-structure', kind: 'line',
    msg: '图标用 lucide-react + Icon，不用 @ant-design/icons', test: (l) => /from\s*['"]@ant-design\/icons/.test(l) },
  { id: 'LOBE-CREATE-STYLES', platforms: WEB, level: 'FAIL', ref: 'D-01', stage: '30-structure', kind: 'line',
    msg: '样式用 createStaticStyles + cssVar（从 @lobehub/ui 导入），不用 createStyles', test: (l) => /\bcreateStyles\b/.test(l) },
  { id: 'LOBE-I18N-PROVIDER', platforms: WEB, level: 'WARN', ref: 'C-01', stage: '30-structure', kind: 'line',
    msg: '不要嵌套 I18nProvider；文案通过 ConfigProvider 的 resources 提供', test: (l) => /<I18nProvider\b/.test(l) },
  { id: 'LOBE-CSS-LINE-COMMENT', platforms: WEB, level: 'FAIL', ref: 'K-10', stage: '30-structure', kind: 'text', raw: true,
    msg: 'css 模板里 // 不是注释；改用 /* */',
    test: (t) => {
      const out = [];
      for (const m of t.matchAll(/css`([\s\S]*?)`/g)) {
        const body = m[1]; const base = m.index + 4;
        for (const lm of body.matchAll(/^[ \t]*\/\/.*$/gm)) out.push({ index: base + lm.index, match: lm[0].trim() });
      }
      return out;
    } },
  { id: 'LOBE-ANT-CLASS', platforms: WEB, level: 'WARN', ref: 'D-10', stage: '30-structure', kind: 'line',
    msg: '写了 .ant- 类名（lobe-ui 不渲染这类类名）；用 className / classNames 槽位、组件文档里的 data-* 属性，不对就修上游', test: (l) => /\.ant-[a-z]/.test(l) },
  { id: 'LOBE-ANT-VAR-OVERRIDE', platforms: WEB, level: 'FAIL', ref: 'D-07', stage: '30-structure', kind: 'line',
    msg: '用 !important 覆盖了主题变量；品牌走 data-primary-color / data-neutral-color（setLobeTheme / LobeThemeScript / ThemeScope）', test: (l) => /--(?:ant|lobe)-[\w-]+\s*:[^;]*!important/.test(l) },
  { id: 'LOBE-REIMPLEMENT-ATOM', platforms: WEB, level: 'WARN', ref: 'C-11', stage: '30-structure', kind: 'line', since: '3.0.0',
    msg: '在项目里重新实现了原子层组件（Button/Modal/Table/Input…）；原子层必须从 @lobehub/ui 取用，业务组合才自建',
    test: (l) => /^\s*(export\s+)?(const|function)\s+(Button|Modal|Drawer|Table|Input|Select|Checkbox|Radio|Switch|Tabs|Tooltip|Popover|Tag|Badge|Avatar|Skeleton|Pagination|Divider|Progress|Spin|Empty)\b/.test(l) },

  // ---- 50-visual (D-/K-/A-) ----
  { id: 'LOBE-RAW-COLOR', level: 'FAIL', ref: 'D-10', stage: '50-visual', kind: 'line',
    msg: '裸 hex / rgba；改用 cssVar token，找不到就按 D-11 写缺口',
    msgMobile: '裸 hex / rgba；改用项目主题 token（RN：useTheme() / theme.colorXxx，来自项目自己的主题或 @lobehub/ui-rn），找不到就按 D-11 写缺口',
    test: (l) => !/^\s*import\b/.test(l) && (/(^|[^&\w])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(l) || /\brgba?\(\s*\d/.test(l)) },
  { id: 'LOBE-FONT-FAMILY', platforms: WEB, level: 'FAIL', ref: 'K-02', stage: '50-visual', kind: 'line',
    msg: '组件里写了 font-family；字体由主题提供（theme.css，自定义字体走 ConfigProvider customFonts；代码用 cssVar.fontFamilyCode）',
    test: (l) => fontFamilyViolation(l) },
  { id: 'LOBE-TRANSITION-ALL', level: 'WARN', ref: 'K-06', stage: '50-visual', kind: 'line',
    msg: 'transition: all 会动画布局属性；只写 transform / opacity 等具体属性', test: (l) => /transition\s*:\s*['"`]?\s*all\b/.test(l) },
  { id: 'LOBE-BOUNCE', level: 'FAIL', ref: 'K-06', stage: '50-visual', kind: 'line',
    msg: '弹跳 / 过冲缓动；用 ease-out（入场）/ ease-in（离场）',
    test: (l) => {
      if (/ease\w*(Bounce|Elastic|Back)\b|\b(bounce|elastic)\b\s*[:(]|animation[^;]*\bbounce\b/i.test(l)) return true;
      for (const m of l.matchAll(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g)) {
        const y1 = +m[2], y2 = +m[4]; if (y1 > 1 || y2 > 1 || y1 < 0 || y2 < 0) return true;
      }
      return false;
    } },
  { id: 'LOBE-MOTION-DURATION', level: 'WARN', ref: 'K-06', stage: '50-visual', kind: 'line',
    msg: 'UI 动效时长 > 300ms',
    test: (l) => {
      if (!/transition|animation|duration/i.test(l) || /setTimeout|debounce|throttle|interval/i.test(l)) return false;
      for (const m of l.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) { const ms = m[2] === 's' ? +m[1] * 1000 : +m[1]; if (ms > 300) return true; }
      const d = l.match(/duration\s*:\s*(\d+(?:\.\d+)?)\s*[,}]/); if (d && +d[1] > 0.3 && +d[1] < 20) return true;
      return false;
    } },
  { id: 'LOBE-PURPLE-GRADIENT', level: 'FAIL', ref: 'A-04', stage: '50-visual', kind: 'line',
    msg: '紫 / 靛起手渐变（AI 味）；品牌时刻用 gradientAnimation，其余用中性底',
    test: (l) => /gradient\(/.test(l) && (PURPLE_NAMES.test(l) || [...l.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].some((m) => isPurpleish(m[0]))) },
  { id: 'LOBE-GRADIENT-TEXT', platforms: WEB, level: 'FAIL', ref: 'A-04', stage: '50-visual', kind: 'line',
    msg: '渐变文字（AI 味）；标题用实色，强调靠字号和字重', test: (l) => /background-clip\s*:\s*text|[bB]ackgroundClip\s*:\s*['"]text/.test(l) },
  { id: 'LOBE-EYEBROW', platforms: WEB, level: 'FAIL', ref: 'A-04', stage: '50-visual', kind: 'line',
    msg: 'eyebrow / kicker 小标签（AI 味）；删掉或并入标题', test: (l) => /class(Name)?=\s*[{'"`][^>]*\b(eyebrow|kicker)\b/i.test(l) },
  { id: 'LOBE-UPPERCASE', level: 'WARN', ref: 'K-02', stage: '50-visual', kind: 'line',
    msg: '中文界面不用 uppercase 标签', test: (l) => /text-transform\s*:\s*uppercase|textTransform\s*:\s*['"]uppercase/.test(l) },
  { id: 'LOBE-GLOW', platforms: WEB, level: 'FAIL', ref: 'A-04', stage: '50-visual', kind: 'line',
    msg: '0 偏移彩色光晕阴影（AI 味）；阴影按档位',
    test: (l) => /box-?[sS]hadow\s*:\s*['"`]?\s*0(px)?\s+0(px)?\s+\d+px[^;'"`]*(#[0-9a-fA-F]{3,8}|rgba?\(\s*(?!0\s*,\s*0\s*,\s*0)|cssVar\.color(Primary|Info|Success|Warning|Error))/.test(l) },
  { id: 'LOBE-BLUR-CARD', platforms: WEB, level: 'WARN', ref: 'K-04', stage: '50-visual', kind: 'line',
    msg: 'backdrop-filter：确认它是浮层或贴顶表面，否则删掉（玻璃只给浮层）', test: (l) => /backdrop-filter|backdropFilter/.test(l) },
  { id: 'LOBE-SIDE-STRIPE', platforms: WEB, level: 'WARN', ref: 'A-04', stage: '50-visual', kind: 'line',
    msg: '>1px 的彩色侧边竖条；用 Alert type 或 图标 + 文字', test: (l) => /border-(left|inline-start)\s*:\s*([2-9]|\d{2,})px/.test(l) },
  { id: 'LOBE-EMOJI-ICON', level: 'WARN', ref: 'A-04', stage: '50-visual', kind: 'line',
    msg: 'emoji 当图标 / 列表符号；用 lucide-react + Icon', test: (l) => />\s*\p{Extended_Pictographic}/u.test(l) },
  { id: 'LOBE-PLACEHOLDER-COPY', level: 'FAIL', ref: 'A-04', stage: '50-visual', kind: 'line',
    msg: '占位文案；用贴近真实业务的数据', test: (l) => /lorem ipsum|示例数据|功能名称|示例文本/i.test(l) },

  // ---- 70-detail (K-05/K-07/W-) ----
  { id: 'LOBE-OUTLINE-NONE', platforms: WEB, level: 'FAIL', ref: 'K-07', stage: '70-detail', kind: 'text',
    msg: 'outline: none 抹掉了全局焦点环；需要退出时用 data-lobe-focus-ring="off" 并补等价指示（不可聚焦的 SVG 图形、同一块里有 :focus-visible 替代指示时不报）',
    test: (t) => outlineNoneHits(t) },
  { id: 'LOBE-IMG-ALT', platforms: WEB, level: 'FAIL', ref: 'K-07', stage: '70-detail', kind: 'text',
    msg: '<img> 缺少 alt', test: (t) => [...t.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/g)].map((m) => ({ index: m.index, match: m[0] })) },
  { id: 'LOBE-DIV-CLICK', platforms: WEB, level: 'WARN', ref: 'K-07', stage: '70-detail', kind: 'text',
    msg: 'div/span 绑定 onClick 但没有 role；优先用 button，或补 role + 键盘处理',
    test: (t) => [...t.matchAll(/<(div|span)\b(?![^>]*\brole=)[^>]*\bonClick=/g)].map((m) => ({ index: m.index, match: m[0] })) },
  { id: 'LOBE-ICON-BUTTON-LABEL', level: 'WARN', ref: 'K-07', stage: '70-detail', kind: 'text',
    msg: '只有图标的按钮缺少 title / aria-label',
    msgMobile: '只有图标的按钮缺少 accessibilityLabel；不是按钮的可点元素再补 accessibilityRole="button"',
    test: (t) => openTags(t, /<(ActionIcon|Button)\b/g).filter((o) => /\bicon=/.test(o.tag) && !/\b(title|aria-label|accessibilityLabel)=/.test(o.tag) && (o.selfClosing || /^\s*<\//.test(t.slice(o.end)))).map((o) => ({ index: o.index, match: o.tag.slice(0, 80) })) },
  { id: 'LOBE-VAGUE-ERROR', level: 'WARN', ref: 'W-05', stage: '70-detail', kind: 'line',
    msg: '模糊错误文案；说清发生了什么 / 为什么 / 怎么办', test: (l) => /['"`>]\s*(操作失败|出错了|发生错误|请求失败|something went wrong|error occurred)\s*[!！。.]?\s*['"`<]/i.test(l) },
  { id: 'LOBE-BARE-EMPTY', level: 'WARN', ref: 'W-04', stage: '70-detail', kind: 'line',
    msg: '孤零零的「暂无数据」；给出下一步或原因', test: (l) => /['"`>]\s*(暂无数据|no data)\s*['"`<]/i.test(l) },
  { id: 'LOBE-VAGUE-BUTTON', level: 'WARN', ref: 'W-01', stage: '40-flow', kind: 'line',
    msg: '按钮文案不是「动词 + 对象」', test: (l) => /<Button\b[^>]*>\s*(确定|提交|OK|Submit|Confirm)\s*<\/Button>/.test(l) },
  { id: 'LOBE-NULLISH-RENDER', level: 'WARN', ref: 'W-06', stage: '70-detail', kind: 'line',
    msg: '空值占位不统一（全站统一用「--」）', test: (l) => /(\?\?|\|\|)\s*['"](N\/A|null|undefined|-|—|–)['"]/.test(l) },

  // ---- 2.1.0：排版 / 留白 / 动效 / 主次 / 响应式 ----
  { id: 'LOBE-FONT-SIZE-SCALE', level: 'WARN', ref: 'A-02', stage: '50-visual', kind: 'text', since: '2.1.0',
    msg: '字阶不成立：单文件字号 > 5 档，或相邻档位挤在一起（比值 < 1.15 的相邻对 ≥ 3 个）；收敛到主题 fontSize* token',
    test: (t) => {
      const first = new Map();
      for (const m of t.matchAll(/font-?[sS]ize\s*:\s*['"`]?(\d+(?:\.\d+)?)(px|rem)?/g)) {
        const v = m[2] === 'rem' ? +m[1] * 16 : +m[1];
        if (!first.has(v)) first.set(v, m.index);
      }
      const sizes = [...first.keys()].sort((a, b) => a - b);
      const crowded = sizes.slice(1).filter((s, i) => s / sizes[i] < 1.15).length;
      if (sizes.length <= 5 && crowded < 3) return [];
      return [{ index: Math.max(...first.values()), match: `${sizes.length} 档：${sizes.join('/')}（拥挤相邻对 ${crowded}）` }];
    } },
  { id: 'LOBE-LETTER-SPACING', level: 'WARN', ref: 'K-02', stage: '50-visual', kind: 'line', since: '2.1.0',
    msg: '加宽字距（≥ 0.05em 或 ≥ 1px）：中文界面不加字距，大写 + 字距是 eyebrow 式 AI 味',
    test: (l) => {
      const m = l.match(/letter-?[sS]pacing\s*:\s*['"`]?(-?\d*\.?\d+)(em|px|rem)?/);
      if (!m) return false;
      const v = +m[1], u = m[2] ?? 'px';
      return u === 'px' ? v >= 1 : v >= 0.05;
    } },
  { id: 'LOBE-SPACING-OFFGRID', level: 'WARN', ref: 'A-05', stage: '50-visual', kind: 'line', since: '2.1.0',
    msg: '间距不在网格上（允许 0/1/2/6 与 4 的倍数）；用主题间距档位',
    test: (l) => {
      const m = l.match(/(?:^|[\s{;,])(margin|padding|gap|row-gap|column-gap|margin-[a-z-]+|padding-[a-z-]+|margin[A-Z]\w*|padding[A-Z]\w*|rowGap|columnGap)\s*:\s*([^;,}]+)/);
      if (!m || /\$\{|cssVar|token|var\(/.test(m[2])) return false;
      return [...m[2].matchAll(/(\d+(?:\.\d+)?)px/g)].some((n) => { const v = +n[1]; return !(v <= 2 || v === 6 || v % 4 === 0); });
    } },
  { id: 'LOBE-ANIMATE-LAYOUT', level: 'WARN', ref: 'K-06', stage: '50-visual', kind: 'line', since: '2.1.0',
    msg: '动画了布局属性（width/height/top/left/margin/padding）会触发重排；只动画 transform / opacity',
    test: (l) => /transition(-property)?\s*:[^;]*(?<![\w-])(width|height|top|left|right|bottom|margin|padding)(?![\w-])/.test(l)
      || /transitionProperty\s*:\s*['"][^'"]*(?<![\w-])(width|height|top|left|margin|padding)(?![\w-])/.test(l) },
  { id: 'LOBE-REDUCED-MOTION', level: 'WARN', ref: 'A-06', stage: '50-visual', kind: 'text', since: '2.1.0',
    msg: '定义了动画 / @keyframes 但文件内没有处理 prefers-reduced-motion',
    test: (t) => {
      const i = t.search(/@keyframes|\banimation\s*:|\bkeyframes`/);
      return i >= 0 && !/prefers-reduced-motion|useReducedMotion|reducedMotion|isReduceMotionEnabled|ReduceMotion/.test(t) ? [{ index: i, match: 'animation / @keyframes' }] : [];
    } },
  { id: 'LOBE-GRADIENT-ANIMATION-OVERUSE', platforms: WEB, level: 'WARN', ref: 'A-07', stage: '50-visual', kind: 'text', since: '2.1.0',
    msg: 'gradientAnimation 一页 > 2 处，品牌时刻失去意义',
    test: (t) => {
      const hits = [...t.matchAll(/\bgradientAnimation\b/g)].filter((m) => !/^\s*import\b/.test(t.slice(t.lastIndexOf('\n', m.index) + 1, m.index + 1)));
      return hits.length > 2 ? [{ index: hits[2].index, match: `${hits.length} 处 gradientAnimation` }] : [];
    } },
  { id: 'LOBE-MULTI-PRIMARY', level: 'WARN', ref: 'W-01', stage: '40-flow', kind: 'text', since: '2.1.0',
    msg: '同一文件出现多个 primary 按钮；一屏只有一个主 CTA，对应 brief 的主任务',
    test: (t) => {
      const hits = [...t.matchAll(/\b(type|variant)=["']primary["']/g)];
      return hits.length > 1 ? [{ index: hits[1].index, match: `${hits.length} 个 primary` }] : [];
    } },
  // ---- 5.4.0：75-copy（zh-CN 排版；也扫 zh-CN 语言包 .json）----
  { id: 'LOBE-CJK-LATIN-SPACE', level: 'WARN', ref: 'T-02', stage: '75-copy', kind: 'line', since: '5.4.0', locale: true,
    msg: '中文与英文 / 数字之间缺空格（「使用 API」「共 3 条」）；插值边界不检查，产品官方写法可豁免',
    test: copyHit(CJK_LATIN) },
  { id: 'LOBE-HALFWIDTH-PUNCT', level: 'WARN', ref: 'T-03', stage: '75-copy', kind: 'line', since: '5.4.0', locale: true,
    msg: '中文里夹了半角标点（, ; : ! ?）；中文句子用全角「，；：！？」',
    test: copyHit(HALF_PUNCT) },
  { id: 'LOBE-FIXED-WIDTH', level: 'WARN', ref: 'D-09', stage: '70-detail', kind: 'line', since: '2.1.0',
    msg: '写死了 ≥ 480px 的 width / min-width，390px 视口会横向溢出；用 max-width / 百分比 / responsive 断点',
    test: (l) => !/matchMedia|@media|\(\s*(min|max)-width/.test(l)
      && [...l.matchAll(/(?<![-\w])(width|min-width|minWidth)\s*:\s*['"`]?(\d+)px\b/g)].some((m) => +m[2] >= 480) },
  // ---- 5.5.0：RN / mobile 专属 ----
  { id: 'LOBE-RN-DOM-UI', level: 'WARN', ref: 'C-01', stage: '30-structure', kind: 'text', since: '5.5.0', platforms: ['mobile'],
    msg: 'RN 界面里导入了 DOM 组件库（@lobehub/ui / antd）；RN 的原子层用项目组件库（如 @lobehub/ui-rn）与 react-native 原语',
    test: (t) => [...t.matchAll(/import\s+(type\s+)?([^;'"]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g)]
      .filter((m) => !m[1] && isDomComponentImport(m[3], m[2]))
      .map((m) => ({ index: m.index, match: m[0].replace(/\s+/g, ' ') })) },
];
// Meta rule: implemented inside lintText (needs every line), listed here so --rules / --only see it.
RULES.push({ id: 'LOBE-IGNORE-NO-REASON', level: 'FAIL', ref: 'L-06', stage: 'learnings', kind: 'meta', since: '2.1.0',
  msg: '豁免注释没有写理由，豁免不生效', test: () => [] });
for (const r of RULES) { r.since ??= '2.0.0'; r.platforms ??= ALL; }

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.less', '.scss']);
// zh-CN 语言包（locales/zh-CN/*.json、zh_CN.json、zh-Hans…）只跑 locale: true 的文案规则
export const isZhLocaleJson = (p) => extname(p) === '.json' && /(?:^|[\\/._-])zh[-_]?(?:cn|hans)(?:[\\/._-]|$)/i.test(p);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.backup']);

function walk(p, out = []) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) if (!SKIP_DIRS.has(name)) walk(join(p, name), out);
  } else if ((EXTS.has(extname(p)) || isZhLocaleJson(p)) && !/\.(test|spec|stories)\.[jt]sx?$/.test(p)) out.push(p);
  return out;
}

const isCommentLine = (l) => /^\s*(\/\/|\/\*|\*)/.test(l);
// A suppression only counts when it carries a reason: `lobe-design-ignore ID[,ID]: <reason>`.
const IGNORE_RE = /lobe-design-ignore(-file)?\s+([A-Z0-9-]+(?:\s*,\s*[A-Z0-9-]+)*)(\s*:\s*\S.*)?/g;
const ignores = (line) => [...(line ?? '').matchAll(IGNORE_RE)].map((m) => ({ file: !!m[1], ids: m[2].split(/\s*,\s*/), reason: !!m[3] }));
const ignoredOn = (line, id) => ignores(line).some((g) => !g.file && g.reason && g.ids.includes(id));

// 单文件平台：文件内 `lobe-design-platform: mobile` 注释 > *.native|ios|android.* 后缀 > opts.platform > web
const PLATFORM_PRAGMA = /lobe-design-platform\s*:\s*(web|desktop|mobile)\b/;
export function filePlatform(text, file, platform) {
  const m = text.match(PLATFORM_PRAGMA);
  if (m) return m[1];
  if (/\.(native|ios|android)\.[jt]sx?$/.test(file)) return 'mobile';
  return platform ?? 'web';
}
// 规则是否被项目层适用性关掉（按 lint id 或它引用的规则编号）
export const ruleOff = (rule, off) => !!off && (off.has(rule.id) || off.has(rule.ref));
export const ruleApplies = (rule, platform, off) => rule.platforms.includes(platform) && !ruleOff(rule, off);

export function lintText(text, file = '<text>', { platform, off } = {}) {
  const plat = filePlatform(text, file, platform);
  const lines = text.split('\n');
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;
  const findings = [];
  const fileIgnored = new Set(lines.flatMap((l) => ignores(l).filter((g) => g.file && g.reason).flatMap((g) => g.ids)));
  lines.forEach((l, i) => {
    if (ignores(l).some((g) => !g.reason)) findings.push({ file, line: i + 1, level: 'FAIL', id: 'LOBE-IGNORE-NO-REASON', ref: 'L-06', stage: 'learnings', msg: '豁免注释没有写理由（格式 `lobe-design-ignore ID: 理由`），豁免不生效', match: l.trim().slice(0, 100) });
  });
  const push = (rule, lineNo, match) => {
    const cur = lines[lineNo - 1] ?? '', prev = lines[lineNo - 2] ?? '';
    if (ignoredOn(cur, rule.id) || ignoredOn(prev, rule.id)) return;
    if (fileIgnored.has(rule.id)) return;
    const msg = plat === 'mobile' && rule.msgMobile ? rule.msgMobile : rule.msg;
    findings.push({ file, line: lineNo, level: rule.level, id: rule.id, ref: rule.ref, stage: rule.stage, msg, match: String(match).trim().slice(0, 100) });
  };
  const json = extname(file) === '.json';
  for (const rule of RULES) {
    if (json && !rule.locale) continue;
    if (rule.kind === 'meta' || !ruleApplies(rule, plat, off)) continue;
    if (rule.kind === 'line') {
      lines.forEach((l, i) => { if (!isCommentLine(l) && rule.test(l)) push(rule, i + 1, l); });
    } else {
      for (const hit of rule.test(text)) {
        const ln = lineOf(hit.index);
        if (!rule.raw && isCommentLine(lines[ln - 1])) continue;
        push(rule, ln, hit.match);
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

// opts: { platform: 'auto'|'web'|'desktop'|'mobile', root }。auto（默认）= 从目标路径向上找项目根，
// 读 .agents/ux/product.md 的平台与适用性（不适用 / lint-off），没有就看 package.json 依赖。
export function lintPaths(paths, { platform = 'auto', root } = {}) {
  const files = paths.flatMap((p) => walk(p));
  const projRoot = root ?? (paths[0] ? findProjectRoot(paths[0]) : null);
  const ctx = projectContext(projRoot, { platform });
  // product.md 的 lint-allow：按路径（相对项目根）关掉指定规则
  const offFor = (f) => {
    if (!ctx.allow.length || !projRoot) return ctx.off;
    const rel = relative(projRoot, f).split(sep).join('/');
    const ids = ctx.allow.filter((a) => a.globs.some((g) => g.test(rel))).flatMap((a) => a.rules);
    return ids.length ? new Set([...ctx.off, ...ids]) : ctx.off;
  };
  const findings = files.flatMap((f) => lintText(readFileSync(f, 'utf8'), f, { ...ctx, off: offFor(f) }));
  return { files, findings, ctx };
}

function report({ files, findings, ctx }, cwd) {
  const out = [`LOBE-DESIGN · LINT   ${files.length} file(s)   platform=${ctx.platform}（${ctx.source}）${ctx.off.size ? `   项目层不适用：${[...ctx.off].join(', ')}` : ''}${ctx.allow?.length ? `   lint-allow：${ctx.allow.map((a) => a.raw).join(' | ')}` : ''}`];
  for (const level of ['FAIL', 'WARN']) {
    const list = findings.filter((f) => f.level === level);
    if (!list.length) continue;
    out.push(level);
    for (const f of list) out.push(`  [${f.id}] ${relative(cwd, f.file)}:${f.line}  ${f.match}\n      → ${f.msg}（${f.ref} · ${f.stage}）`);
  }
  const fail = findings.filter((f) => f.level === 'FAIL').length;
  const warn = findings.length - fail;
  out.push(`RESULT: ${fail} FAIL, ${warn} WARN`);
  return { text: out.join('\n'), fail };
}

const HELP = `lobe-design lint — LobeUI 架构 / 审美（反 AI 味）/ a11y / 微文案 / 中文排版的确定性静态检查（零依赖）

用法
  node scripts/lint-lobe.mjs <文件或目录...> [选项]
  目录里的 zh-CN 语言包（locales/zh-CN/*.json 等）只跑 75-copy 的文案规则

选项
  --json              以 JSON 输出 findings
  --stage <id>        只跑某个 stage 的规则（30-structure | 40-flow | 50-visual | 70-detail | 75-copy）
  --only <ID,ID>      只跑指定规则
  --platform <p>      auto（默认）| web | desktop | mobile。auto 读项目根 .agents/ux/product.md 的「平台：」，
                      没有就看 package.json（react-native / expo / @lobehub/ui-rn → mobile）
  --root <dir>        项目根（默认从目标路径向上找 package.json / .agents/ux）

平台与项目层适用性
  每条规则声明 platforms（--rules 可见）。mobile 跳过 web 专属检查（cssVar / createStaticStyles / antd /
  CSS 类名 / outline / font-family / <img> / div onClick 等），K-07 图标按钮接受 accessibilityLabel，
  @lobehub/ui-rn 是 RN 的原子层，不算「重新实现」。
  product.md 里 \`lint-allow: LOBE-RN-DOM-UI src/components/hooks/**, src/shared/markdown/*.ts\` 按路径（相对项目根，
  * 不跨目录、** 跨目录）关掉指定规则，可写多行；行内至少要有一个规则 id。
  product.md 里标「不适用 / N/A」的规则编号（C-01、C-01..C-11）或 lint id，以及 \`lint-off: LOBE-XXX, D-01\` 行，
  都会关掉对应规则。单文件可写注释 lobe-design-platform: mobile；*.native|ios|android.tsx 视为 mobile。
  --rules             列出全部规则（级别 / id / 引用的 reference 规则 / stage / 引入版本）
  -h, --help          显示本帮助

退出码
  0  没有 FAIL（可能有 WARN）
  1  至少一个 FAIL
  2  用法错误（没有路径、路径不存在、未知规则）

豁免（必须写理由，否则报 LOBE-IGNORE-NO-REASON 且豁免不生效）
  // lobe-design-ignore LOBE-RAW-COLOR: <理由>        同一行或上一行
  // lobe-design-ignore-file LOBE-RAW-COLOR: <理由>   整个文件

新增规则：见 learnings/README.md「升级为 lint」；每条规则必须在 tests/fixtures/ 有 bad/good 回归样例（tests/run.mjs 校验）。`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(HELP); process.exit(0); }
  if (args.includes('--rules')) {
    for (const r of RULES) console.log(`${r.level.padEnd(4)} ${r.id.padEnd(32)} ${r.ref.padEnd(5)} ${r.stage.padEnd(13)} v${r.since.padEnd(6)} ${(r.platforms === ALL ? 'all' : r.platforms.join('/')).padEnd(12)} ${r.msg}`);
    console.log(`TOTAL: ${RULES.length} rules`);
    process.exit(0);
  }
  const optVal = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const stage = optVal('--stage'), only = optVal('--only')?.split(',');
  const platform = optVal('--platform') ?? 'auto', rootOpt = optVal('--root');
  if (!['auto', 'web', 'desktop', 'mobile'].includes(platform)) { console.error(`用法错误：未知平台：${platform}（auto | web | desktop | mobile）`); process.exit(2); }
  const paths = args.filter((a, i) => !a.startsWith('-') && !['--stage', '--only', '--platform', '--root'].includes(args[i - 1]));
  if (!paths.length) { console.error('用法错误：缺少目标路径。\n\n' + HELP); process.exit(2); }
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length) { console.error(`用法错误：路径不存在：${missing.join(', ')}`); process.exit(2); }
  const unknown = (only ?? []).filter((id) => !RULES.some((r) => r.id === id));
  if (unknown.length) { console.error(`用法错误：未知规则：${unknown.join(', ')}（--rules 查看全部）`); process.exit(2); }
  const res = lintPaths(paths, { platform, root: rootOpt });
  res.findings = res.findings.filter((f) => (!stage || f.stage === stage) && (!only || only.includes(f.id)));
  if (args.includes('--json')) {
    console.log(JSON.stringify(res.findings, null, 2));
    process.exitCode = res.findings.some((f) => f.level === 'FAIL') ? 1 : 0;
  } else {
    const { text, fail } = report(res, process.cwd());
    console.log(text);
    process.exitCode = fail ? 1 : 0; // exitCode (not exit) so piped output is fully flushed
  }
}

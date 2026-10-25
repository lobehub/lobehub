/**
 * Converts the body of one emotion css`` block into a StyleX style object literal.
 *
 * Supported: declarations, `${cssVar.*}` values, `${responsive.*}` and @media /
 * @container / @supports blocks, pseudo-classes on the element itself (`&:hover`,
 * `&:not(:disabled)`), and one pseudo-element (`&::before`). Anything else —
 * descendant or attribute selectors, `!important`, other interpolations — throws
 * an UnsupportedCssError so the caller can leave the file to manual migration.
 */
import postcss, { type ChildNode, type Container } from 'postcss';

export class UnsupportedCssError extends Error {}

export interface CssTemplate {
  /** Source text of each `${…}` expression, in order. */
  expressions: string[];
  /** Raw text between the expressions; one more entry than `expressions`. */
  quasis: string[];
}

export interface ConvertedStyle {
  /** JS source of the style object, e.g. `{ color: cssVar.colorText }`. */
  code: string;
  usesCssVar: boolean;
  usesMedia: boolean;
}

/** Identifiers that refer to the token objects inside the css`` callback. */
export interface TokenNames {
  cssVar: Set<string>;
  responsive: Set<string>;
}

const PLACEHOLDER = /__lobeX(\d+)__/g;
const NUMERIC_PROPS = new Set([
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'lineHeight',
  'opacity',
  'order',
  'zIndex',
]);
const BORDER_STYLES = new Set([
  'dashed',
  'dotted',
  'double',
  'groove',
  'hidden',
  'inset',
  'none',
  'outset',
  'ridge',
  'solid',
]);

// max-width of each lobe-ui breakpoint; `desktop` / `xxl` are min-width 1200px.
const BREAKPOINT_MAX: Record<string, number> = {
  laptop: 991.98,
  lg: 991.98,
  md: 767.98,
  mobile: 479.98,
  sm: 575.98,
  tablet: 767.98,
  xl: 1199.98,
  xs: 479.98,
};

// Mirrors @stylexjs/babel-plugin 0.19 getPseudoClassPriority: compound keys and
// the table's camelCase entries (`:focusVisible`) fall back to 40.
const PSEUDO_PRIORITY: Record<string, number> = {
  ':active': 170,
  ':checked': 101,
  ':disabled': 92,
  ':empty': 70,
  ':enabled': 91,
  ':first-child': 52,
  ':focus': 150,
  ':hover': 130,
  ':last-child': 54,
  ':placeholder-shown': 97,
  ':visited': 85,
};
const AT_RULE_PRIORITY: Record<string, number> = {
  '@container': 300,
  '@media': 200,
  '@supports': 30,
};

/** Priority of a rendered condition key: `":hover"`, `[media.sm]`, `"@media …"`. */
const conditionPriority = (key: string) => {
  if (key.startsWith('[media.')) return AT_RULE_PRIORITY['@media'];
  const raw = JSON.parse(key) as string;
  if (raw.startsWith('@')) return AT_RULE_PRIORITY[raw.split(' ')[0]] ?? 0;
  return PSEUDO_PRIORITY[raw.split('(')[0]] ?? 40;
};

const kebab = (prop: string) =>
  prop.startsWith('--')
    ? prop
    : prop.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^(webkit|moz|ms)-/, '-$1-');

/** Longhands a shorthand resets that do not share its name as a prefix. */
const SHORTHAND_EXTRA: [RegExp, RegExp][] = [
  [/^gap$/, /^(row|column)-gap$/],
  [/^inset$/, /^(top|right|bottom|left)$/],
  [/^border-radius$/, /^border-.+-radius$/],
  [/^border-(color|style|width)$/, /^border-.+-(color|style|width)$/],
  [/^border$/, /^border-.+$/],
  [/^font$/, /^line-height$/],
  [/^flex-flow$/, /^flex-(direction|wrap)$/],
  [/^place-(items|content|self)$/, /^(align|justify)-(items|content|self)$/],
];

export const isShorthandOf = (short: string, long: string) => {
  const [s, l] = [kebab(short), kebab(long)];
  if (s === l) return false;
  // `border` does not reset these, despite the shared prefix.
  if (s === 'border' && /-(?:radius|spacing|collapse)$|^border-collapse$/.test(l)) return false;
  if (l.startsWith(`${s}-`)) return true;
  return SHORTHAND_EXTRA.some(([a, b]) => a.test(s) && b.test(l));
};

type ValueNode = { children: Map<string, ValueNode>; value?: string };
type Rendered = { expr: string; usesCssVar: boolean };

const camelCase = (prop: string) =>
  prop.startsWith('--')
    ? prop
    : prop
        .replace(/^-(webkit|moz|ms)-/, (_m, v: string) => `${v[0].toUpperCase()}${v.slice(1)}-`)
        .replaceAll(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/** Splits on top-level whitespace, keeping parentheses and placeholders intact. */
const tokens = (value: string) => {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
};

const sides = (prefix: string, suffix: string, values: string[]): [string, string][] => {
  const [top, right = top, bottom = top, left = right] = values;
  return [
    [`${prefix}Top${suffix}`, top],
    [`${prefix}Right${suffix}`, right],
    [`${prefix}Bottom${suffix}`, bottom],
    [`${prefix}Left${suffix}`, left],
  ];
};

/** StyleX rejects multi-value shorthands; expand them into longhands it accepts. */
export const expandShorthand = (prop: string, value: string): [string, string][] => {
  const parts = tokens(value);

  if (['margin', 'padding', 'scrollMargin', 'scrollPadding'].includes(prop)) {
    if (parts.length === 1) return [[prop, value]];
    if (parts.length === 2)
      return [
        [`${prop}Block`, parts[0]],
        [`${prop}Inline`, parts[1]],
      ];
    return sides(prop, '', parts);
  }
  if (prop === 'inset') {
    if (parts.length === 1) return [[prop, value]];
    return sides('', '', parts).map(([p, v]) => [p.toLowerCase(), v]);
  }
  if (/^(?:margin|padding|inset|scrollMargin|scrollPadding)(?:Block|Inline)$/.test(prop)) {
    if (parts.length === 1) return [[prop, value]];
    return [
      [`${prop}Start`, parts[0]],
      [`${prop}End`, parts[1]],
    ];
  }
  if (prop === 'gap' && parts.length === 2)
    return [
      ['rowGap', parts[0]],
      ['columnGap', parts[1]],
    ];
  if (prop === 'overflow' && parts.length === 2)
    return [
      ['overflowX', parts[0]],
      ['overflowY', parts[1]],
    ];
  if (prop === 'borderRadius' && parts.length > 1) {
    if (value.includes('/')) throw new UnsupportedCssError(`border-radius: ${value}`);
    const [tl, tr = tl, br = tl, bl = tr] = parts;
    return [
      ['borderTopLeftRadius', tl],
      ['borderTopRightRadius', tr],
      ['borderBottomRightRadius', br],
      ['borderBottomLeftRadius', bl],
    ];
  }
  if (prop === 'flex' && parts.length > 1) {
    const [grow, second, third] = parts;
    const secondIsShrink = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(second);
    return [
      ['flexGrow', grow],
      ...(secondIsShrink ? [['flexShrink', second] as [string, string]] : []),
      ['flexBasis', secondIsShrink ? (third ?? '0%') : second],
    ];
  }
  if (/^(?:border|outline)(?:(?:Top|Right|Bottom|Left|Block|Inline)(?:Start|End)?)?$/.test(prop)) {
    if (parts.length === 1 && (parts[0] === 'none' || parts[0] === '0'))
      return [[`${prop}Style`, 'none']];
    const result: [string, string][] = [];
    const color: string[] = [];
    for (const part of parts) {
      if (BORDER_STYLES.has(part)) result.push([`${prop}Style`, part]);
      else if (/^(?:\d|\.\d|thin$|medium$|thick$)/.test(part)) result.push([`${prop}Width`, part]);
      else color.push(part);
    }
    if (color.length > 1) throw new UnsupportedCssError(`${prop}: ${value}`);
    if (color.length === 1) result.push([`${prop}Color`, color[0]]);
    return result;
  }
  // StyleX compiles `background` and `animation` to no class at all, without an error.
  if (prop === 'background') {
    if (value.trim() === 'none')
      return [
        ['backgroundColor', 'transparent'],
        ['backgroundImage', 'none'],
      ];
    if (/^(?:inherit|initial|unset|revert|revert-layer)$/.test(value.trim()))
      return [
        ['backgroundColor', value],
        ['backgroundImage', value],
      ];
    const isImage = /^(?:url|image-set|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/;
    // The shorthand also resets the image a component may have set.
    if (parts.length === 1 && !isImage.test(parts[0]))
      return [
        ['backgroundColor', value],
        ['backgroundImage', 'none'],
      ];
    throw new UnsupportedCssError(`background: ${value}`);
  }
  if (prop === 'animation') throw new UnsupportedCssError(`animation: ${value}`);
  return [[prop, value]];
};

export const convertCss = (template: CssTemplate, names: TokenNames): ConvertedStyle => {
  let usesCssVar = false;
  let usesMedia = false;

  const exprOf = (index: number) => template.expressions[index].trim();
  const tokenRef = (expr: string, kind: keyof TokenNames) => {
    const match = /^([$A-Z_][\w$]*)\.(\w+)$/i.exec(expr);
    return match && names[kind].has(match[1]) ? match[2] : undefined;
  };

  const renderValue = (prop: string, raw: string): Rendered => {
    const value = raw.trim();
    if (/!important/i.test(value)) throw new UnsupportedCssError(`!important in ${prop}`);
    let cssVarUsed = false;
    let hasInterpolation = false;
    const pieces: string[] = [];
    let last = 0;
    let onlyPlaceholder = false;
    for (const match of value.matchAll(PLACEHOLDER)) {
      const expr = exprOf(Number(match[1]));
      const token = tokenRef(expr, 'cssVar');
      // Other plain references (module constants) are kept for the StyleX
      // compiler to evaluate; the codemod's compile step rejects unresolvable ones.
      if (!token && !/^[$A-Z_][\w$]*(?:\.[\w$]+)*$/i.test(expr))
        throw new UnsupportedCssError(`interpolation \${${expr}}`);
      if (token) cssVarUsed = true;
      hasInterpolation = true;
      pieces.push(value.slice(last, match.index).replaceAll(/[$`\\]/g, String.raw`\$&`));
      pieces.push(token ? `\${cssVar.${token}}` : `\${${expr}}`);
      last = match.index + match[0].length;
      onlyPlaceholder = match.index === 0 && last === value.length;
    }
    if (hasInterpolation) {
      if (onlyPlaceholder) return { expr: pieces[1].slice(2, -1), usesCssVar: cssVarUsed };
      pieces.push(value.slice(last).replaceAll(/[$`\\]/g, String.raw`\$&`));
      return { expr: `\`${pieces.join('')}\``, usesCssVar: cssVarUsed };
    }
    if (NUMERIC_PROPS.has(prop) && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))
      return { expr: String(Number(value)), usesCssVar: false };
    return { expr: JSON.stringify(value), usesCssVar: false };
  };

  // prop → condition tree. Pseudo-elements get their own nested style object.
  const roots = new Map<string, Map<string, ValueNode>>();
  const declared: { context: string; prop: string }[] = [];
  const setValue = (pseudoElement: string, conditions: string[], prop: string, value: string) => {
    declared.push({ context: `${pseudoElement}|${conditions.join('|')}`, prop });
    const props = roots.get(pseudoElement) ?? new Map<string, ValueNode>();
    roots.set(pseudoElement, props);
    let node: ValueNode = props.get(prop) ?? { children: new Map() };
    props.set(prop, node);
    for (const condition of conditions) {
      const child: ValueNode = node.children.get(condition) ?? { children: new Map() };
      node.children.set(condition, child);
      node = child;
    }
    node.value = value;
  };

  const walk = (container: Container, conditions: string[], pseudoElement: string) => {
    for (const node of container.nodes ?? []) visit(node, conditions, pseudoElement);
  };

  const visit = (node: ChildNode, conditions: string[], pseudoElement: string) => {
    if (node.type === 'comment') return;
    if (node.type === 'decl') {
      const prop = camelCase(node.prop);
      if (node.important) throw new UnsupportedCssError(`!important in ${node.prop}`);
      for (const [longhand, value] of expandShorthand(prop, node.value)) {
        const rendered = renderValue(longhand, value);
        usesCssVar ||= rendered.usesCssVar;
        setValue(pseudoElement, conditions, longhand, rendered.expr);
      }
      return;
    }
    if (node.type === 'atrule') {
      if (!['container', 'media', 'supports'].includes(node.name))
        throw new UnsupportedCssError(`@${node.name}`);
      if (PLACEHOLDER.test(node.params))
        throw new UnsupportedCssError(`@${node.name} interpolation`);
      PLACEHOLDER.lastIndex = 0;
      walk(node, [...conditions, JSON.stringify(`@${node.name} ${node.params}`)], pseudoElement);
      return;
    }
    if (node.type !== 'rule') return;
    for (const raw of node.selectors) {
      const selector = raw.trim();
      const placeholder = /^__lobeX(\d+)__$/.exec(selector);
      if (placeholder) {
        const breakpoint = tokenRef(exprOf(Number(placeholder[1])), 'responsive');
        if (!breakpoint)
          throw new UnsupportedCssError(`selector \${${exprOf(Number(placeholder[1]))}}`);
        usesMedia = true;
        walk(node, [...conditions, `[media.${breakpoint}]`], pseudoElement);
        continue;
      }
      const match = /^&((?::[\w-]+(?:\([^&]*\))?)*)(::[\w-]+)?$/.exec(selector);
      if (!match || (!match[1] && !match[2])) throw new UnsupportedCssError(`selector ${selector}`);
      const [, pseudoClasses, element] = match;
      if (element && pseudoElement) throw new UnsupportedCssError(`selector ${selector}`);
      const next = pseudoClasses ? [...conditions, JSON.stringify(pseudoClasses)] : conditions;
      walk(node, next, element ?? pseudoElement);
    }
  };

  let css = template.quasis[0];
  for (let i = 0; i < template.expressions.length; i++) {
    css += `__lobeX${i}__${template.quasis[i + 1]}`;
  }
  // Emotion accepts // line comments; postcss does not.
  css = css.replaceAll(/^\s*\/\/.*$/gm, '');

  let root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    throw new UnsupportedCssError(`unparsable css: ${(error as Error).message.split('\n')[0]}`);
  }
  walk(root, [], '');

  // StyleX always lets a longhand beat its shorthand; emotion lets the later rule
  // win. They agree only for shorthand-then-longhand within one condition.
  for (const [i, a] of declared.entries()) {
    for (const b of declared.slice(i + 1)) {
      // a is declared before b.
      const conflict =
        (isShorthandOf(a.prop, b.prop) && a.context !== b.context) || isShorthandOf(b.prop, a.prop);
      if (conflict) throw new UnsupportedCssError(`shorthand conflict: ${a.prop} / ${b.prop}`);
    }
  }

  // StyleX orders conditions by a fixed priority, emotion by source order (later
  // wins). Keep a property only when both agree: priorities rising in source
  // order, and overlapping max-width queries going from wide to narrow.
  const checkConditionOrder = (node: ValueNode) => {
    const keys = [...node.children.keys()];
    if (keys.length < 2) return;
    const priorities = keys.map(conditionPriority);
    for (let i = 1; i < keys.length; i++) {
      const [prev, cur] = [priorities[i - 1], priorities[i]];
      const bothMedia = prev === AT_RULE_PRIORITY['@media'] && cur === prev;
      if (bothMedia) {
        const [a, b] = [keys[i - 1], keys[i]].map((k) => BREAKPOINT_MAX[k.slice(7, -1)]);
        if (a === undefined || b === undefined || b >= a)
          throw new UnsupportedCssError(`overlapping media order: ${keys[i - 1]}, ${keys[i]}`);
      } else if (cur <= prev) {
        throw new UnsupportedCssError(`condition order: ${keys[i - 1]} before ${keys[i]}`);
      }
    }
  };

  const renderNode = (node: ValueNode): string => {
    checkConditionOrder(node);
    if (node.children.size === 0) return node.value ?? 'null';
    const entries = [`default: ${node.value ?? 'null'}`];
    for (const [condition, child] of node.children)
      entries.push(`${condition}: ${renderNode(child)}`);
    return `{ ${entries.join(', ')} }`;
  };
  const key = (prop: string) => (/^[$A-Z_][\w$]*$/i.test(prop) ? prop : JSON.stringify(prop));
  const renderProps = (props: Map<string, ValueNode>) =>
    [...props].map(([prop, node]) => `${key(prop)}: ${renderNode(node)}`);

  const entries = renderProps(roots.get('') ?? new Map());
  for (const [element, props] of roots) {
    if (element) entries.push(`${JSON.stringify(element)}: { ${renderProps(props).join(', ')} }`);
  }

  return { code: `{ ${entries.join(', ')} }`, usesCssVar, usesMedia };
};

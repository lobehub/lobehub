import type { Combo } from '../plan/combos';
import { partlyForwardedDetail } from './labels';

interface Cause {
  after?: string;
  before?: string;
  property: string;
}

const FAMILIES: Array<[string, RegExp]> = [
  ['元素', /^(node|tag|text)$/],
  ['边框', /^border/],
  ['轮廓', /^outline/],
  ['背景', /^background/],
  ['文字颜色', /^color$/],
  ['阴影', /shadow$/],
  ['动画', /^(animation|transition)/],
  ['字体', /^(font|line-height|letter-spacing|text-|white-space|word-)/],
  ['间距', /^(padding|margin|gap|row-gap|column-gap)/],
  ['位置', /^(inset|top|right|bottom|left|position|z-index|transform)/],
  ['尺寸', /(width|height|-size)$|^(inline-size|block-size)/],
  ['布局', /^(display|flex|align|justify|grid|order|place)/],
];

const familyOf = (property: string) =>
  FAMILIES.find(([, pattern]) => pattern.test(property))?.[0] ?? '其他';

const shown = (value: string | undefined) =>
  value === undefined || value === 'undefined' ? '不存在' : value;

const borderLine = (causes: Cause[]) => {
  const edge = causes[0].property.replace(/-(width|style|color)$/, '');
  const part = (name: string) => causes.find((cause) => cause.property === `${edge}-${name}`);
  const [width, style, color] = [part('width'), part('style'), part('color')];
  if (!width && !style) return undefined;
  const describe = (side: 'after' | 'before') => {
    if (style?.[side] === 'none' || width?.[side] === '0px') return '无';
    return [width?.[side], style?.[side], color?.[side]].filter(Boolean).join(' ');
  };
  return `边框 ${describe('before')} → ${describe('after')}`;
};

const familyLine = (family: string, causes: Cause[]) => {
  const border = family === '边框' ? borderLine(causes) : undefined;
  if (border) return border;
  const [first] = causes;
  return `${family} ${shown(first.before)} → ${shown(first.after)}`;
};

export const differenceSummary = (causes: Cause[], limit = 2) => {
  const families = new Map<string, Cause[]>();
  for (const cause of causes) {
    const family = familyOf(cause.property);
    families.set(family, [...(families.get(family) ?? []), cause]);
  }
  const lines = [...families].slice(0, limit).map(([family, list]) => familyLine(family, list));
  const rest = families.size - limit;
  return rest > 0 ? [...lines, `另有 ${rest} 处`] : lines;
};

export const comboLabel = (combo: Combo) => {
  const entries = Object.entries(combo);
  return entries.length
    ? entries
        .map(
          ([name, value]) => `${name}：${typeof value === 'string' ? value : value ? '是' : '否'}`,
        )
        .join(' · ')
    : '默认';
};

const GAPS: Record<string, string> = {
  CONTAINER_UNMODELED: '容器查询',
  MEDIA_UNMODELED: '媒体查询',
  PSEUDO_UNMODELED: '伪元素',
  STATE_UNMODELED: '工具触发不了的交互状态',
};

export interface AskContext {
  component?: string;
  prop?: string;
  variables: string[];
}

export const askSentence = (item: { category: string; flags: string[] }, context: AskContext) => {
  if (item.category === 'blocking') return '工具渲染这个元素时出错了，没有截图可看。';
  if (item.category === 'unpaired') return '这个元素只在一侧出现，看一下是不是本来就该删掉或新增。';
  if (item.category === 'difference' && !item.flags.length)
    return '工具发现左右不一样，看一下是不是迁移造成的。';
  const names = new Set(item.flags.map((flag) => flag.split(':')[0]));
  const lines: string[] = [];
  if (names.has('VARIABLE_UNMODELED'))
    lines.push(
      `这个元素的样子取决于 ${context.variables.join('、') || '运行时数据'}，工具没法自己枚举。看一下每种取值下左右是不是一样。`,
    );
  if (names.has('PLACEMENT_SUBSTITUTED') || names.has('PLACEMENT_NEUTRAL_PROP'))
    lines.push(
      `样式交给 ${context.component ?? '组件'} 的 ${context.prop ?? 'className'} 处理，组件内部怎么用它工具看不到。`,
    );
  const partly = item.flags.find((flag) => flag.startsWith('INNER_TARGET_PARTLY_FORWARDED:'));
  if (partly) {
    const { components, tag } = partlyForwardedDetail(partly.slice(partly.indexOf(':') + 1));
    lines.push(
      `旧代码给容器里所有的 ${tag} 加了样式，新代码只把它传给了组件里的那一个 ${tag}（已单独证明）。${components ? `看一下 ${components} 里还会不会渲染 ${tag}，` : ''}如果会，那些 ${tag} 迁移后就没有这条样式了。`,
    );
  }
  const callers = item.flags.find((flag) => flag.startsWith('FORWARDED_CALLER_UNCHECKED:'));
  if (callers)
    lines.push(
      `这个元素的样式由调用方传进来。没传的情况已比较过；${callers
        .slice(callers.indexOf(':') + 1)
        .split(',')
        .join('、')} 也提到了这个属性，工具没有比较它们传的样式。`,
    );
  if (names.has('RUNTIME_STYLE_DROPPED'))
    lines.push(
      '改之前和改之后只有一侧给这个元素传了 style={…}，另一侧把它去掉了。截图里看不出运行时样式，看一下代码里是不是漏传了。',
    );
  if (names.has('INLINE_STYLE_SPREAD_ORDER'))
    lines.push(
      '两侧的 style 一样，只是和 {...展开属性} 的先后顺序换了，或者只有一侧有展开属性。确认展开的对象里没有 style，就没有影响。',
    );
  if (names.has('STYLE_OUTSIDE_JSX')) lines.push('这个文件在 JSX 之外也用到了样式，工具比较不了。');
  if (names.has('GLOBAL_RULES_CHANGED'))
    lines.push('这个文件的全局样式规则两侧对不上，看一下少掉或改掉的那几条是不是有意的。');
  const gaps = [...names].filter((name) => GAPS[name]).map((name) => GAPS[name]);
  if (gaps.length) lines.push(`这条样式只在${gaps.join('、')}下生效，工具触发不了。`);
  if (!lines.length) lines.push('工具对这一项有拿不准的地方，看一下左右是不是一样。');
  if (item.category === 'difference') lines.unshift('工具发现左右不一样。');
  return lines.join('');
};

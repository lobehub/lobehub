export const CATEGORY_LABELS: Record<string, string> = {
  'blocking': '阻塞',
  'difference': '差异',
  'equal': '已证明相等',
  'needs-signoff': '需签收',
  'unpaired': '未配对',
};

export const THEME_LABELS: Record<string, string> = { dark: '暗色', light: '亮色' };

const STATE_LABELS: Record<string, string> = {
  'default': '默认',
  'focus-visible': 'focus',
  'hover-chain': 'hover 链',
  'hover-target': 'hover',
};

const VARIANT_LABELS: Record<string, string> = { 'reduced-motion': '减弱动效', 'rtl': 'RTL' };

export const stateLabel = (state: string, variant?: string) =>
  variant
    ? (VARIANT_LABELS[variant] ?? variant)
    : (STATE_LABELS[state] ?? state.replace(/^force(-chain)?:/, ''));

export const FLAG_LABELS: Record<string, string> = {
  ASYMMETRIC_CONDITION: '条件只在一侧',
  COMBINATIONS_PAIRWISE: '组合两两覆盖',
  CONTAINER_UNMODELED: '容器查询未建模',
  CROSS_COMPONENT: '跨组件选择器',
  INNER_TARGET: '命中组件内部',
  MEDIA_UNMODELED: '媒体条件未建模',
  PLACEMENT_NEUTRAL_PROP: '非 className 属性',
  PLACEMENT_SUBSTITUTED: '组件替换成 div',
  PSEUDO_UNMODELED: '伪元素读不到',
  TAG_CHANGED: '标签变了',
  TOOL_FALSE_POSITIVE: '工具误报',
  UNPAIRED: '两侧配不上',
  VARIABLE_UNMODELED: '变量无法枚举',
};

export const flagLabel = (flag: string) => FLAG_LABELS[flag] ?? flag;

export const shortKey = (key: string) => key.slice(key.indexOf('|') + 1);

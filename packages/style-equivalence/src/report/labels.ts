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

export const FLAG_EXPLANATIONS: Record<string, string> = {
  ASYMMETRIC_CONDITION: '某个条件变量只出现在一侧，两侧的组合没法一一对应。',
  COMBINATIONS_PAIRWISE: '条件变量的组合超过 16 种，只做了两两覆盖，不是全组合。',
  CONTAINER_UNMODELED: '两侧命中这个元素的 @container 规则不同，容器尺寸没有建模。',
  CROSS_COMPONENT:
    '别的组件的选择器会命中这个元素（比如 .muted .control-label），合成环境里没有那个外层组件，这条规则的效果没有被比较。',
  INNER_TARGET:
    '全局 CSS 的选择器指向组件内部的元素（比如 Image 里的 img），合成渲染看不到组件内部。',
  MEDIA_UNMODELED:
    '两侧命中这个元素的媒体条件不同，而且不是宽度条件（比如 hover: none），没有建模。',
  PLACEMENT_NEUTRAL_PROP:
    '样式通过 itemClassName、classNames 这类非 className 的属性传进组件，落到哪个节点由组件决定。',
  PLACEMENT_SUBSTITUTED:
    '元素是非布局组件，合成时换成了 div，只证明了样式槽本身等价，没证明组件把样式放在哪里。',
  PSEUDO_UNMODELED:
    '两侧命中这个元素的伪类或伪元素规则不同（比如 ::selection、::-webkit-scrollbar），读不到计算样式。',
  TAG_CHANGED: '两侧的标签不同，浏览器默认样式和语义可能不同。',
  TOOL_FALSE_POSITIVE:
    '比较器报了差异，但这个用例带有上面的某个标记；签收表示确认差异是合成环境造成的，不是真实回归。',
  UNPAIRED: '一侧多出或少了带样式的元素，没有可以比较的对象，只能逐条确认。',
  VARIABLE_UNMODELED: '样式值依赖 props 或运行时数据，没法枚举取值。',
};

export const SUBMIT_ERRORS: Record<string, string> = {
  NOTE_REQUIRED: '写一句说明再签收：你是怎么确认的。',
  NOTHING_SELECTED: '先勾选要签收的用例。',
  UNPAIRED_ONE_BY_ONE: '两侧配不上的元素只能一条一条签收。',
};

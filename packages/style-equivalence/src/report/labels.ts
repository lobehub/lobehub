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
  DIFFERENCE_NOT_REPRODUCED: '差异没有复现',
  INLINE_STYLE_MASKED: '两侧同一个 style 盖住了类样式',
  INLINE_STYLE_SPREAD_ORDER: 'style 与展开属性顺序变了',
  INNER_TARGET: '命中组件内部',
  MEDIA_UNMODELED: '媒体条件未建模',
  PLACEMENT_NEUTRAL_PROP: '非 className 属性',
  PLACEMENT_SUBSTITUTED: '组件替换成 div',
  PSEUDO_UNMODELED: '伪元素读不到',
  RUNTIME_STYLE_DROPPED: '运行时 style 只在一侧',
  STATE_UNMODELED: '状态伪类未建模',
  STYLE_OUTSIDE_JSX: 'JSX 外的样式引用',
  TAG_CHANGED: '标签变了',
  TOOL_FALSE_POSITIVE: '工具误报',
  UNPAIRED: '两侧配不上',
  VARIABLE_UNMODELED: '变量无法枚举',
};

const GAP_LABELS: Record<string, string> = {
  STYLESHEET_UNPARSEABLE: '样式表解析失败',
  STYLESHEET_UNREADABLE: '样式表读不到',
};

const listed = (text: string) => text.split(',').filter(Boolean).join('、');

export const partlyForwardedDetail = (detail: string) => {
  const [tag, components = ''] = detail.split('|');
  return { components: listed(components), tag };
};

const globalCounts = (detail: string) => {
  const [removed = '0', added = '0'] = detail.split('/');
  return { added, removed };
};

const DETAIL_LABELS: Record<string, (detail: string) => string> = {
  STYLEX_UNSUPPORTED: (detail) => `StyleX 不支持 ${detail} 属性`,
  GLOBAL_RULES_CHANGED: (detail) => {
    const { added, removed } = globalCounts(detail);
    return `全局样式规则变了（少了 ${removed} 条，多了 ${added} 条）`;
  },
  FORWARDED_CALLER_UNCHECKED: (detail) => `有调用方没比较：${listed(detail)}`,
  INNER_TARGET_PARTLY_FORWARDED: (detail) =>
    `只证明了传进组件的那个 ${partlyForwardedDetail(detail).tag}`,
};

const DETAIL_EXPLANATIONS: Record<string, (detail: string) => string> = {
  STYLEX_UNSUPPORTED: (detail) =>
    `stylex.create 里写了 ${detail}，StyleX 编译时会把它丢掉，不生成任何样式（比如 all: 'unset' 不会重置按钮的原生外观）。改成逐条写出要重置的属性。`,
  GLOBAL_RULES_CHANGED: (detail) => {
    const { added, removed } = globalCounts(detail);
    return `文件里不挂在任何元素上的全局规则（createGlobalStyle、引入的全局 CSS）两侧不一致：改之前有 ${removed} 条在改之后找不到原样的对应，改之后有 ${added} 条是新的。原样保留的规则会自动证明，这里要确认差别是有意的。`;
  },
  FORWARDED_CALLER_UNCHECKED: (detail) =>
    `组件内部这个元素按「调用方没有传这个样式」渲染并比较了。仓库里还有这些文件提到了这个属性，但工具没有逐一比较它们传进来的样式：${listed(detail)}。`,
  INNER_TARGET_PARTLY_FORWARDED: (detail) => {
    const { components, tag } = partlyForwardedDetail(detail);
    return `旧规则命中容器里所有的 ${tag}；新代码只把样式交给了组件里的那一个 ${tag}，这一处已单独渲染证明。其余地方的 ${tag}（${components || '容器里的其它内容'} 里渲染的）迁移后不再有这条样式，工具没有证明它们不存在。`;
  },
};

export const flagLabel = (flag: string) => {
  const [name, detail] = flag.split(/:(.*)/s);
  if (FLAG_LABELS[flag]) return FLAG_LABELS[flag];
  if (DETAIL_LABELS[name] && detail !== undefined) return DETAIL_LABELS[name](detail);
  return GAP_LABELS[name] ? `${GAP_LABELS[name]}：${detail}` : flag;
};

export const shortKey = (key: string) => key.slice(key.indexOf('|') + 1);

export const FLAG_EXPLANATIONS: Record<string, string> = {
  ASYMMETRIC_CONDITION: '某个条件变量只出现在一侧，两侧的组合没法一一对应。',
  COMBINATIONS_PAIRWISE: '条件变量的组合超过 16 种，只做了两两覆盖，不是全组合。',
  CONTAINER_UNMODELED: '两侧命中这个元素的 @container 规则不同，容器尺寸没有建模。',
  CROSS_COMPONENT:
    '别的组件的选择器会命中这个元素（比如 .muted .control-label），合成环境里没有那个外层组件，这条规则的效果没有被比较。',
  DIFFERENCE_NOT_REPRODUCED:
    '一些条件下出现过差异，单独重跑这些用例时没有复现。可能是渲染时序造成的抖动，也可能只在整页组合下出现，需要人工确认。',
  INLINE_STYLE_MASKED:
    '两侧给这个元素传了同一个 style={…}，它盖住了类样式里的同名属性。有这个值时两侧一样；只有这个值在运行时为空值（属性没传、函数返回 undefined、?? / && 短路）时，露出来的类样式不一样。确认一下它不会是空值。',
  INLINE_STYLE_SPREAD_ORDER:
    '两侧传的 style={…} 写法一样，但它和 {...props} 这类展开属性的先后顺序两侧不同，或者只有一侧有展开属性。展开对象里如果带 style，两侧谁覆盖谁就不同；工具不知道展开对象里有什么。',
  INNER_TARGET:
    '全局 CSS 的选择器指向组件内部的元素（比如 Image 里的 img），合成渲染看不到组件内部。',
  MEDIA_UNMODELED:
    '两侧命中这个元素的媒体条件不同，而且不是宽度条件（比如 hover: none），没有建模。',
  PLACEMENT_NEUTRAL_PROP:
    '样式通过 itemClassName、classNames 这类非 className 的属性传进组件，落到哪个节点由组件决定。',
  PLACEMENT_SUBSTITUTED:
    '元素是非布局组件，合成时换成了 div，只证明了样式槽本身等价，没证明组件把样式放在哪里。',
  PSEUDO_UNMODELED:
    '两侧命中这个元素的伪元素规则不同（比如 ::selection、::-webkit-scrollbar），读不到计算样式。',
  RUNTIME_STYLE_DROPPED:
    '同一个元素一侧传了 style={…}（运行时才知道的值），另一侧完全没有传，也没有把这个值交给样式调用。工具不渲染运行时值，左右截图一致不能说明 style 没丢。',
  STATE_UNMODELED:
    '两侧命中这个元素的状态伪类规则不同（比如 :checked、:disabled、:invalid），采集时元素不在这些状态，这部分样式没有被比较。',
  STYLE_OUTSIDE_JSX:
    '文件在 JSX 之外引用了样式（比如先算出 className 再传给元素），合成环境不知道它落在哪个元素上，这部分样式没有被比较。',
  STYLESHEET_UNPARSEABLE: '文件引入的样式表解析失败，里面的规则没有被比较。',
  STYLESHEET_UNREADABLE: '文件引入的样式表读不到（比如包里的 CSS），里面的规则没有被比较。',
  TAG_CHANGED: '两侧的标签不同，浏览器默认样式和语义可能不同。',
  TOOL_FALSE_POSITIVE:
    '比较器报了差异，但这个用例带有上面的某个标记；签收表示确认差异是合成环境造成的，不是真实回归。',
  UNPAIRED: '一侧多出或少了带样式的元素，没有可以比较的对象，只能逐条确认。',
  VARIABLE_UNMODELED: '样式值依赖 props 或运行时数据，没法枚举取值。',
};

export const flagExplanation = (flag: string) => {
  const [name, detail] = flag.split(/:(.*)/s);
  if (DETAIL_EXPLANATIONS[name] && detail !== undefined) return DETAIL_EXPLANATIONS[name](detail);
  return FLAG_EXPLANATIONS[flag] ?? FLAG_EXPLANATIONS[name];
};

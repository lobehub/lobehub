export const UNMODELED_SHAPES: Array<{ text: string; title: string }> = [
  {
    text: '改之前用 `& + &`（相邻同类元素）加分隔样式，改之后改成调用方传的 separated 这类属性。合成环境每个元素只挂一份，也不知道哪个调用点传了属性，两侧对不上会报成差异。',
    title: '兄弟选择器换成调用方属性',
  },
  {
    text: '合成环境只挂当前这一行，:last-child、:nth-child 这类位置选择器命中的结果和真实列表不同。改之后换成显式属性时，会报成差异。',
    title: '位置伪类依赖真实列表',
  },
  {
    text: '改之前用 `.table th`、`.kv dt` 这类嵌套标签规则写样式，合成环境里的占位子元素没有这些标签，会和没有样式的占位元素配对。',
    title: '嵌套标签规则',
  },
  {
    text: '组件把 xstyle 继续传给子组件时，工具不会跟进到子组件里去渲染，样式落在哪个节点没有被比较。',
    title: 'xstyle 继续往下传',
  },
];

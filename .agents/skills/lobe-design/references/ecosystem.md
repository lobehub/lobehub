# ecosystem.md — 生态包

<!-- refs:meta
tier: index
scope: 生态包；只在需要图表 / 徽标 / emoji / 流式 markdown 时取
entries:
  E-01  | deep | 图表,chart,折线,柱状,饼图
  E-02  | deep | 图表颜色,主题色,series
  E-03  | deep | 模型徽标,厂商,logo,icon
  E-04  | deep | emoji,表情
  E-05  | deep | 流式,markdown,streamdown
  E-06  | deep | 边界,依赖,不引入第二个库
-->

界面里的模型徽标、图表、emoji 和流式 markdown 不要自己造，也不要随手引第三方。这些都有生态包覆盖，并且已经接入同一套主题。

## 安装清单

按 `@lobehub/ui` 自己声明的 peer 装，不要另锁一套旧版本：

- `react` / `react-dom` `^19`
- `motion` `^13` 或 `^14`
- `@lobehub/icons` `^6` 与 `@lobehub/fluent-emoji` `^5` —— 两者是 peer。不装的话 `Avatar`、`FluentEmoji`、`EmojiPicker` 会在运行时失败。`@lobehub/icons` 和 `@lobehub/ui` 互为 peer，必须同时安装。

样式 API（`createStaticStyles`、`cssVar`、`useTheme`）从 `@lobehub/ui` 导入，不另装样式库。应用根部导入一次 `@lobehub/ui/theme.css` 与 `@lobehub/ui/style.css`（要页面级字体、底色、滚动条再加 `global.css`）。

`@lobehub/charts` 是独立包，不是 `@lobehub/ui` 的依赖。`@lobehub/streamdown` 是直接依赖，不要再单独接一份去驱动 markdown。

## E-01 `@lobehub/charts` —— 图表

基于 **recharts**。单一入口，没有 exports map：

```ts
import { LineChart, useThemeColorRange } from '@lobehub/charts';
```

Next.js 里需要 `transpilePackages: ['@lobehub/charts']`。

**应用根部必须已导入 `@lobehub/ui/theme.css`。** 包本身不提供主题，轴标签、网格线、填充取的是 lobe-ui 的 `cssVar`，明暗跟随 `data-theme`。

### 选哪个图表

| 需要                   | 用                                                              |
| ---------------------- | --------------------------------------------------------------- |
| 时间趋势、多系列       | `LineChart` / `AreaChart`（`AreaChart` 可 `stack`）             |
| 类别对比               | `BarChart`（`layout`: `vertical`/`horizontal`，可 `stack`）     |
| 柱 + 线、双 Y 轴       | `ComposedChart`                                                 |
| 占比 / 构成            | `DonutChart`（`variant`: `donut`/`pie`）                        |
| 阶段转化 / 流失        | `FunnelChart`（`calculateFrom`: `first`/`previous`）            |
| X 与 Y 的相关性        | `ScatterChart`（可用 `size` 做气泡）                            |
| 多维度画像             | `RadarChart`                                                    |
| 模型榜单               | `BenchmarkRankingChart`（横向）/ `BenchmarkColumnChart`（纵向） |
| 准确率 ± 误差          | `AccuracyBarChart`                                              |
| 日活跃度方格图         | `Heatmaps`                                                      |
| 行内微型趋势           | `SparkLineChart` / `SparkAreaChart` / `SparkBarChart`           |
| 简单排名条             | `BarList`（支持每项 `href`）                                    |
| 单值 KPI / 进度 / 增减 | `ProgressBar` / `DeltaBar` / `MarkerBar` / `CategoryBar`        |
| 状态 / 可用性条带      | `Tracker`                                                       |

### 共享 props

笛卡尔类图表共用 `BaseChartProps`，核心是这几个：

```tsx
<LineChart
  categories={['SolarPanels', 'Inverters']} // 要画哪些系列
  data={data} // 数据数组
  index="date" // 横轴取哪个字段
  valueFormatter={(n) => `$${n.toLocaleString()}`}
  onValueChange={(v) => console.log(v)}
/>
```

其余常用开关：`colors`、`showLegend`、`showTooltip`、`showGridLines`、`showXAxis` / `showYAxis`、`loading`、`noDataText`、`customTooltip`、`height` / `width`、`yAxisWidth`、`autoMinValue`、`minValue` / `maxValue`、`stack`。

`loading` 和 `noDataText` 是内建的——**不要自己在外面包一层加载和空态**，图表已经处理了（对应 [craft.md](craft.md) 的 K-05）。

**三个图表不走这套 `categories` + `index` 约定**，照抄会直接报错或画不出来：

| 图表            | 取数据的字段                                                    |
| --------------- | --------------------------------------------------------------- |
| `ScatterChart`  | `x` · `y` · `category`（单数），气泡大小用 `size` + `sizeRange` |
| `DonutChart`    | `index`（默认 `'name'`）+ `category`（单数，默认 `'value'`）    |
| `ComposedChart` | `series: { key, type: 'bar'\|'line', axis: 'left'\|'right' }[]` |

`BenchmarkRankingChart` / `BenchmarkColumnChart` 又是另一套：字段名通过 `valueKey` / `errorKey` / `iconKey` / `providerKey` 等「key 映射 props」指定，默认读 `name` / `score` / `error`。

### E-02 图表颜色必须走主题

不传 `colors` 时，多数图表默认取 `useThemeColorRange()`，顺序是：

```
geekblue · gold · green · cyan · purple · red · volcano · gray
再接各色的 7 号阶
```

要自定义时从主题取值，**不要手写 hex**：

```tsx
import { useTheme } from '@lobehub/ui';

const theme = useTheme();

<LineChart colors={[theme.purple, theme.cyan]} categories={[...]} data={data} index="date" />;
```

三条约束：

- `colors` 收的是**解析后的颜色值**，不接受 `"geekblue"` 这类 token 名字符串。
- `Heatmaps` 的 `colors` 必须是真实颜色值而不是 `cssVar` 字符串——它内部用 `chroma.valid()` 校验。
- 业务语义色要**稳定映射**：成功/增长、警告、危险/下降各自固定，不能随系列顺序漂移。否则「红色」可能只是第一个系列，不代表任何含义，用户无法信任这个颜色。

暗色模式没有专门的 prop，跟随 `data-theme`。`Heatmaps` 和 `DonutChart` 内部会按 `isDarkMode` 换阶。

### 已知坑

- `BenchmarkRankingChart` / `BenchmarkColumnChart` **不自带图标和品牌色**，要由调用方传入（配合 E-03）。`highlighted: true` 只强调文字，不改柱子填充。
- `ComposedChart` 在数据区间很窄时（例如 80–95% 的成功率）recharts 默认的 `[0, auto]` 会把差异压平，需要显式给 `yAxisLeft.domain` / `yAxisRight.domain`。
- 空态 `NoData` 的默认文案是英文（「No Data」）。中文界面在应用里包一层，按界面语言统一给 `noDataText`，不要在每个调用处补。
- 调用处传了 `data ?? []` 却没传 `loading` 时，加载中会被画成空态。加载时传 `loading`；查询失败时换成带原因和重试的失败画面，不要把空数组交给图表（K-05）。

## E-03 `@lobehub/icons` —— AI 模型与厂商徽标

约 340 个品牌（72 个模型、136 个厂商、132 个应用），**只有 AI 相关品牌徽标，不是通用 UI 图标集**。通用图标用 `@lobehub/ui` 的 `Icon`。

每个品牌是一个复合组件：默认导出就是单色图标，变体挂在静态属性上。

```tsx
import { Claude } from '@lobehub/icons';

<Claude size={64} />         {/* 单色，fill="currentColor"，跟随文字色 */}
<Claude.Color size={64} />   {/* 全彩，颜色写死在 SVG 里 */}
<Claude.Text />              {/* 文字标 */}
<Claude.Combine type="color" /> {/* 图标 + 文字标 */}
<Claude.Avatar shape="circle" size={40} /> {/* 头像徽章 */}

Claude.colorPrimary; // '#D97757'
Claude.title; // 'Claude'
```

变体的可用性**因品牌而异**，用前别假设：

| 变体      | 覆盖情况                                              |
| --------- | ----------------------------------------------------- |
| `Avatar`  | 340 / 340，全都有                                     |
| `Combine` | 324 个有                                              |
| `Color`   | 226 个有——**`OpenAI` 和 `Anthropic` 就没有 `.Color`** |
| `Text`    | 几乎都有                                              |

共享 props：`size`（默认 `'1em'`）、`color`、`title`，以及全部标准 SVG 属性。`Avatar` 另有 `shape`（`circle`/`square`）、`background`、`iconMultiple`、`iconStyle`。

### 按字符串运行时解析

这是这个包最有用的能力——AI 应用通常只拿到一个模型名或厂商 id，不可能静态导入 340 个品牌：

```tsx
import { ModelIcon, ProviderIcon } from '@lobehub/icons';

<ModelIcon model="gpt-4o" size={24} type="color" />
<ProviderIcon provider="anthropic" size={24} type="avatar" />
```

`type` 取 `avatar` | `mono` | `color` | `combine` | `combine-color`。

| 组件           | 匹配方式                     | 映射数量 | 未命中时            |
| -------------- | ---------------------------- | -------- | ------------------- |
| `ModelIcon`    | 关键词**正则**，首个命中为准 | 87       | lucide `Brain` 兜底 |
| `ProviderIcon` | 小写**精确**相等             | 116      | 通用插头图标兜底    |
| `AgentIcon`    | 同上                         | 38       | 兜底图标            |

配套还有 `ModelTag`（内嵌 `ModelIcon` 的标签）、`ProviderCombine`、`ModelProvider` 枚举、以及 `getLobeIconCDN()`（静态资源 URL）。

**没有**按 id 取组件的对象映射表（不存在 `icons['openai']` 这种用法），查找只能通过上面三个解析组件或直接命名导入。

渲染不出图标通常意味着**映射表里缺条目**，而不是缺 SVG 组件。

具名的模型、厂商或产品用 avatar 变体（`type="avatar"` 或命名导入的 `.Avatar`）：`.Avatar` 全覆盖，`.Color` 不全，缺 `.Color` 时不要拿单色标硬凑，单色标在深色底上会融进文字色。`@lobehub/ui/icons` 里的 lucide 扩展图标（如 `McpIcon`、`SkillsIcon`）表示**类别**，不表示某个产品。

`ProviderIcon` 比的是映射表的 keywords，不是业务里的厂商 id。业务 id 常带连字符、实例号或套餐后缀，先折成关键字再传：

1. trim、小写，去掉非字母数字。
2. 去掉末尾的实例号（`xxx-1` → `xxx`）。
3. 取以折叠后的 id 开头的最长关键字；没有任何关键字是它的前缀、且恰好一个关键字以它开头时用那一个，多于一个就不要猜。
4. 仍对不上就传原 id，让兜底图标留在界面上，不要换成一个邻近品牌。格子里的可见文字仍是原来的 id。

`ModelIcon` 自己用正则，模型 id 直接传，不要套这套折叠。

暗色模式：单色图标用 `currentColor`，跟随文字色自动适配；`.Color` 是写死的，不会自动切换。

**注意区分两个同名的东西**：`@lobehub/ui/icons` 是另一个命名空间，装的是 OAuth / 社交平台徽标（Auth0、Discord、Slack、WeChat 等）和一批 lucide 扩展图标；`@lobehub/icons` 才是 AI 品牌库。lobe-ui 只从后者转出了 `Cloudflare` 和 `Github` 两个。

## E-04 `@lobehub/fluent-emoji` —— emoji 资源

`@lobehub/ui` 的 peer，为 `FluentEmoji` 组件和 `Avatar` 的 emoji 回退（内部调 `getEmoji`）提供资源。

通过 `FluentEmoji` 组件使用即可，不需要直接调这个包：

```tsx
<FluentEmoji emoji="🤯" size={64} type="anim" />
```

`type` 取 `anim` | `flat` | `modern` | `mono` | `raw` | `3d`。资源走 CDN，CDN 来源由 `ConfigProvider` 的 `proxy` 配置决定（默认 aliyun，可选 unpkg / jsdelivr / custom）。

## E-05 `@lobehub/streamdown` —— 流式 markdown

`@lobehub/ui` 的**直接依赖**，不需要单独安装，也不需要直接调用。它驱动 `Markdown` 组件的流式渲染、LaTeX 预处理和代码块淡入动画。

要流式输出就用 `Markdown` 的开关，不要绕过它自己接 streamdown：

```tsx
<Markdown variant="chat" animated enableStream enableLatex enableMermaid>
  {content}
</Markdown>
```

lobe-ui 根入口另外转出了 `rehypeStreamAnimated`，用于需要自定义 rehype 管线的场景。

## E-06 边界

| 需要                             | 归属                                                                      |
| -------------------------------- | ------------------------------------------------------------------------- |
| 图表                             | `@lobehub/charts`                                                         |
| AI 模型 / 厂商徽标               | `@lobehub/icons`                                                          |
| OAuth / 社交徽标                 | `@lobehub/ui/icons`                                                       |
| 通用界面图标（lucide）           | `@lobehub/ui` 的 `Icon`                                                   |
| emoji                            | `@lobehub/ui` 的 `FluentEmoji`                                            |
| markdown / 流式输出              | `@lobehub/ui` 的 `Markdown`                                               |
| 表格 / 徽标 / 进度 / 评分 / 加载 | `@lobehub/ui` 的 `Table` / `Badge` / `Progress` / `Rate` / `Spin` |
| 文档站工程                       | `@lobehub/docs-kit`（`lobedocs` CLI，本仓库 `packages/`）                 |

不要为了一个图表引入第二个图表库，也不要为了一个模型徽标去抓远程 SVG——两者都会让产物脱离主题体系，直接命中 [evaluator.md](evaluator.md) 的「图表不像系统」和「设计系统不一致」。

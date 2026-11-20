# ecosystem.md — 生态包

<!-- refs:meta
tier: index
scope: 生态包；组件库 / 编辑器 / 代码规范，以及图表 / 徽标 / emoji / 流式 markdown
entries:
  E-01  | deep | 组件库,lobe-ui,ui,@lobehub/ui
  E-02  | deep | 编辑器,editor,lexical,ChatInput,富文本
  E-03  | deep | 图表,chart,折线,柱状,饼图
  E-04  | deep | 模型徽标,厂商,logo,icon
  E-05  | deep | emoji,表情
  E-06  | deep | 流式,markdown,streamdown
  E-07  | deep | lint,eslint,prettier,commitlint,代码规范
  E-08  | deep | 边界,依赖,不引入第二个库
  E-09  | deep | 图表颜色,主题色,series
-->

界面与工程侧的常用能力不要自己造，也不要随手引第三方：组件库用 `@lobehub/ui`，富文本 / 聊天输入用 `@lobehub/editor`，代码规范用 `@lobehub/lint`；模型徽标、图表、emoji 和流式 markdown 也都有对应生态包，并且已经接入同一套主题。

## 安装清单

按 `@lobehub/ui` 自己声明的 peer 装，不要另锁一套旧版本：

- `react` / `react-dom` `^19`
- `motion` `^13` 或 `^14`
- `@lobehub/icons` `^6` 与 `@lobehub/fluent-emoji` `^5` —— 两者是 peer。不装的话 `Avatar`、`FluentEmoji`、`EmojiPicker` 会在运行时失败。`@lobehub/icons` 和 `@lobehub/ui` 互为 peer，必须同时安装。

样式 API（`createStaticStyles`、`cssVar`、`useTheme`）从 `@lobehub/ui` 导入，不另装样式库。应用根部导入一次 `@lobehub/ui/theme.css` 与 `@lobehub/ui/style.css`（要页面级字体、底色、滚动条再加 `global.css`）。

`@lobehub/charts` 是独立包，不是 `@lobehub/ui` 的依赖。`@lobehub/streamdown` 是直接依赖，不要再单独接一份去驱动 markdown。

## 生态 skills（Agent 文档入口）

每个有 docs 站的生态包会发布 `/skills.md`（由 `@lobehub/docs-kit` / `lobedocs build` 生成），供下游 Agent 查阅组件与 API。lobe-design 用脚本按依赖自动安装到项目的 `.agents/skills/<name>/SKILL.md`，不要让 Agent 手工 clone。

```bash
node "$LOBE_DESIGN/scripts/install-ecosystem-skills.mjs" --root .
# 只看映射与命中：加 --list；CI 比对是否过期：加 --check；强制重拉：加 --force
```

| npm 包                                    | skill 目录名   | skills.md                                    | 状态                                 |
| ----------------------------------------- | -------------- | -------------------------------------------- | ------------------------------------ |
| `@lobehub/ui`                             | `lobe-ui`      | <https://ui.lobehub.com/skills.md>           | ok                                   |
| `@lobehub/lint`（及 `@lobehub/*-config`） | `lobe-lint`    | <https://lint.lobehub.com/skills.md>         | ok                                   |
| `@lobehub/editor`                         | `lobe-editor`  | <https://editor.lobehub.com/skills.md>       | ok                                   |
| `@lobehub/icons`                          | `lobe-icons`   | <https://icons.lobehub.com/skills.md>        | ok                                   |
| `@lobehub/charts`                         | `lobe-charts`  | <https://charts.lobehub.com/skills.md>       | ok                                   |
| `@lobehub/tts`                            | `lobe-tts`     | <https://tts.lobehub.com/skills.md>          | ok                                   |
| `@lobehub/fluent-emoji`                   | `fluent-emoji` | <https://fluent-emoji.lobehub.com/skills.md> | ok                                   |
| `@lobehub/streamdown`                     | `streamdown`   | <https://streamdown.lobehub.com/skills.md>   | ok                                   |
| `@lobehub/docs-kit`                       | —              | —                                            | missing（仅仓库内 `.agents/skills`） |
| `@lobehub/ui-rn`                          | —              | —                                            | missing（暂无公开 skills.md）        |

映射源文件：`scripts/ecosystem-skills.json`。装完或升级依赖后重跑脚本；`bootstrap.mjs` 默认会带上这一步。

## E-01 `@lobehub/ui` —— AI 应用组件库

仓库：[lobehub/lobe-ui](https://github.com/lobehub/lobe-ui)。文档与演示：[ui.lobehub.com](https://ui.lobehub.com)。

LobeHub 开源的 React 组件库，面向 AI 聊天与 AIGC Web 应用：从落地页到管理后台同一套设计语言；LLM 输出（Markdown、代码、Mermaid、diff、HTML 预览）和聊天界面有现成零件，不必从零拼。

### 安装与根部

安装与 peer 见上文「安装清单」。根部最少：

```tsx
import '@lobehub/ui/theme.css';
import '@lobehub/ui/style.css';

import { Button, ConfigProvider } from '@lobehub/ui';
import { motion } from 'motion/react';

export default () => (
  <ConfigProvider motion={motion}>
    <Button type="primary">Hello AIGC</Button>
  </ConfigProvider>
);
```

ESM only；需要 React 19。v6 起不再依赖 Ant Design，从 5.x 升级看 [v6 migration](https://ui.lobehub.com/migration-v6)。

### 入口

| 入口                                                                   | 用途                             |
| ---------------------------------------------------------------------- | -------------------------------- |
| `@lobehub/ui`                                                          | 核心组件、`ConfigProvider`、主题 |
| `@lobehub/ui/chat` · `@lobehub/ui/mobile`                              | 聊天与移动端                     |
| `@lobehub/ui/dashboard` · `@lobehub/ui/pro-table` · `@lobehub/ui/form` | 后台、数据表、表单               |
| `@lobehub/ui/awesome` · `@lobehub/ui/brand` · `@lobehub/ui/mdx`        | 落地页、品牌、MDX 文档           |
| `@lobehub/ui/icons` · `@lobehub/ui/i18n`                               | 平台徽标、文案包                 |

Agent 优先读 [skills.md](https://ui.lobehub.com/skills.md) 与 [llms.txt](https://ui.lobehub.com/llms.txt)，只使用文档里出现的组件、props 和导入路径。具体选哪个零件见 [components.md](components.md)。

## E-02 `@lobehub/editor` —— 富文本 / 聊天输入

仓库：[lobehub/lobe-editor](https://github.com/lobehub/lobe-editor)。文档：[editor.lobehub.com](https://editor.lobehub.com)。

基于 Meta Lexical 的 React 富文本编辑器，覆盖聊天输入框、Markdown 文档与模型改稿（用户可逐条接受 / 拒绝）。不要另接一套 TipTap / Slate / 自研 Lexical 壳来做同一件事。

### 安装

```bash
pnpm add @lobehub/editor
```

Peer：`react` / `react-dom` 19、`@lobehub/ui`、`motion`（与 E-01 同一套，不要锁第二套版本）。

### 入口

| 入口                       | 用途                                       |
| -------------------------- | ------------------------------------------ |
| `@lobehub/editor`          | 插件、命令、编辑器内核                     |
| `@lobehub/editor/react`    | `Editor`、`ChatInput`、`SendButton`、hooks |
| `@lobehub/editor/headless` | 服务端读写文档（无 DOM）                   |
| `@lobehub/editor/renderer` | 只读渲染与 diff（SSR 友好）                |

最小示例（列表 / 链接 / 代码块）：

```tsx
import { ReactCodeblockPlugin, ReactLinkPlugin, ReactListPlugin } from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';

export default function MyEditor() {
  const editor = useEditor();

  return (
    <Editor
      editor={editor}
      placeholder="Type / for commands..."
      plugins={[ReactListPlugin, ReactLinkPlugin, ReactCodeblockPlugin]}
      onTextChange={(ed) => {
        console.log(ed.getDocument('markdown'));
      }}
    />
  );
}
```

聊天场景用 `ChatInput`（斜杠命令、`@` mention、附件、发送按钮），不要在 `Input.TextArea` 上重造一套。Markdown 快捷输入、粘贴与导出是一等能力：`getDocument('markdown')` / JSON。Agent 读 [skills.md](https://editor.lobehub.com/skills.md)。

## E-03 `@lobehub/charts` —— 图表

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

`loading` 和 `noDataText` 是内建的 ——**不要自己在外面包一层加载和空态**，图表已经处理了（对应 [craft.md](craft.md) 的 K-05）。

**三个图表不走这套 `categories` + `index` 约定**，照抄会直接报错或画不出来：

| 图表            | 取数据的字段                                                    |
| --------------- | --------------------------------------------------------------- |
| `ScatterChart`  | `x` · `y` · `category`（单数），气泡大小用 `size` + `sizeRange` |
| `DonutChart`    | `index`（默认 `'name'`）+ `category`（单数，默认 `'value'`）    |
| `ComposedChart` | `series: { key, type: 'bar'\|'line', axis: 'left'\|'right' }[]` |

`BenchmarkRankingChart` / `BenchmarkColumnChart` 又是另一套：字段名通过 `valueKey` / `errorKey` / `iconKey` / `providerKey` 等「key 映射 props」指定，默认读 `name` / `score` / `error`。

### E-09 图表颜色必须走主题

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
- `Heatmaps` 的 `colors` 必须是真实颜色值而不是 `cssVar` 字符串 —— 它内部用 `chroma.valid()` 校验。
- 业务语义色要**稳定映射**：成功 / 增长、警告、危险 / 下降各自固定，不能随系列顺序漂移。否则「红色」可能只是第一个系列，不代表任何含义，用户无法信任这个颜色。

暗色模式没有专门的 prop，跟随 `data-theme`。`Heatmaps` 和 `DonutChart` 内部会按 `isDarkMode` 换阶。

### 已知坑

- `BenchmarkRankingChart` / `BenchmarkColumnChart` **不自带图标和品牌色**，要由调用方传入（配合 E-04）。`highlighted: true` 只强调文字，不改柱子填充。
- `ComposedChart` 在数据区间很窄时（例如 80–95% 的成功率）recharts 默认的 `[0, auto]` 会把差异压平，需要显式给 `yAxisLeft.domain` / `yAxisRight.domain`。
- 空态 `NoData` 的默认文案是英文（「No Data」）。中文界面在应用里包一层，按界面语言统一给 `noDataText`，不要在每个调用处补。
- 调用处传了 `data ?? []` 却没传 `loading` 时，加载中会被画成空态。加载时传 `loading`；查询失败时换成带原因和重试的失败画面，不要把空数组交给图表（K-05）。

## E-04 `@lobehub/icons` —— AI 模型与厂商徽标

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

| 变体      | 覆盖情况                                               |
| --------- | ------------------------------------------------------ |
| `Avatar`  | 340 / 340，全都有                                      |
| `Combine` | 324 个有                                               |
| `Color`   | 226 个有 ——**`OpenAI` 和 `Anthropic` 就没有 `.Color`** |
| `Text`    | 几乎都有                                               |

共享 props：`size`（默认 `'1em'`）、`color`、`title`，以及全部标准 SVG 属性。`Avatar` 另有 `shape`（`circle`/`square`）、`background`、`iconMultiple`、`iconStyle`。

### 按字符串运行时解析

这是这个包最有用的能力 ——AI 应用通常只拿到一个模型名或厂商 id，不可能静态导入 340 个品牌：

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

## E-05 `@lobehub/fluent-emoji` —— emoji 资源

`@lobehub/ui` 的 peer，为 `FluentEmoji` 组件和 `Avatar` 的 emoji 回退（内部调 `getEmoji`）提供资源。

通过 `FluentEmoji` 组件使用即可，不需要直接调这个包：

```tsx
<FluentEmoji emoji="🤯" size={64} type="anim" />
```

`type` 取 `anim` | `flat` | `modern` | `mono` | `raw` | `3d`。资源走 CDN，CDN 来源由 `ConfigProvider` 的 `proxy` 配置决定（默认 aliyun，可选 unpkg /jsdelivr/custom）。

## E-06 `@lobehub/streamdown` —— 流式 markdown

`@lobehub/ui` 的**直接依赖**，不需要单独安装，也不需要直接调用。它驱动 `Markdown` 组件的流式渲染、LaTeX 预处理和代码块淡入动画。

要流式输出就用 `Markdown` 的开关，不要绕过它自己接 streamdown：

```tsx
<Markdown variant="chat" animated enableStream enableLatex enableMermaid>
  {content}
</Markdown>
```

lobe-ui 根入口另外转出了 `rehypeStreamAnimated`，用于需要自定义 rehype 管线的场景。

## E-07 `@lobehub/lint` —— 代码规范

仓库：[lobehub/lobe-lint](https://github.com/lobehub/lobe-lint)。文档：[lint.lobehub.com](https://lint.lobehub.com)。

LobeHub 共用的 ESLint / Prettier / Stylelint / Commitlint / Remarklint /semantic-release 配置；`@lobehub/lint` 是聚合包，也可按需只装单个 `@lobehub/*-config`。不要在仓库里再维护一份平行的 ESLint 规则集。

### 一键接入

```bash
npx create-lobe-lint
# 非交互推荐预设：
npx create-lobe-lint --preset -y
```

### 聚合包用法

```bash
pnpm add -D @lobehub/lint
# 另装各工具 peer：eslint、prettier、stylelint、@commitlint/cli、remark-cli、semantic-release、typescript@^6
```

```js
// eslint.config.mjs
import { defineConfig } from '@lobehub/lint';

export default defineConfig({
  react: true, // 或 'next' / 'remix' / 'vite' / 'expo'
});
```

```js
// prettier.config.mjs
import { prettier } from '@lobehub/lint';

export default prettier;
```

同模式还有 `stylelint`、`commitlint`、`remarklint`、`semanticRelease` / `semanticReleaseMonoRepo`。Oxlint 走 ESM 子路径 `@lobehub/lint/oxlint` 的 `defineOxlintConfig`。changelog /release 若宿主用 cosmiconfig 旧版读不了 `.mjs`，改用 `@lobehub/lint/changelog`、`@lobehub/lint/release` 的 CJS 入口（见该包 README）。 Agent 读 [skills.md](https://lint.lobehub.com/skills.md)。

### 也可拆开安装

| 包                                 | 用途               |
| ---------------------------------- | ------------------ |
| `@lobehub/eslint-config`           | ESLint flat config |
| `@lobehub/oxlint-config`           | Oxlint             |
| `@lobehub/prettier-config`         | Prettier           |
| `@lobehub/stylelint-config`        | CSS / Less         |
| `@lobehub/commitlint-config`       | Gitmoji commit     |
| `@lobehub/remarklint-config`       | Markdown           |
| `@lobehub/semantic-release-config` | 发版与 changelog   |
| `create-lobe-lint`                 | 脚手架 CLI         |

## E-08 边界

| 需要                              | 归属                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| 应用组件 / 主题 / 后台壳          | `@lobehub/ui`（E-01）                                             |
| 富文本 / 聊天输入 / 模型改稿      | `@lobehub/editor`（E-02）                                         |
| ESLint / Prettier / Commitlint 等 | `@lobehub/lint`（E-07）                                           |
| 图表                              | `@lobehub/charts`                                                 |
| AI 模型 / 厂商徽标                | `@lobehub/icons`                                                  |
| OAuth / 社交徽标                  | `@lobehub/ui/icons`                                               |
| 通用界面图标（lucide）            | `@lobehub/ui` 的 `Icon`                                           |
| emoji                             | `@lobehub/ui` 的 `FluentEmoji`                                    |
| markdown / 流式输出               | `@lobehub/ui` 的 `Markdown`                                       |
| 表格 / 徽标 / 进度 / 评分 / 加载  | `@lobehub/ui` 的 `Table` / `Badge` / `Progress` / `Rate` / `Spin` |
| 文档站工程                        | `@lobehub/docs-kit`（`lobedocs` CLI）                             |

不要为了一个图表引入第二个图表库，也不要为了一个模型徽标去抓远程 SVG，更不要再接第二套组件库或编辑器 —— 都会让产物脱离主题体系，直接命中 [evaluator.md](evaluator.md) 的「图表不像系统」和「设计系统不一致」。

# aesthetics.md — 审美准则与反 AI 味（A-）

<!-- refs:meta
tier: index
scope: 审美准则；方向卡、字阶、配色比例、反 AI 味、密度、Lobe 兼容边界
entries:
  A-09  | always | 写样式前必看的 LobeUI 兼容速查
  A-01  | deep | 方向,记忆点,方向卡
  A-02  | deep | 字阶,字号,字重,层级
  A-03  | deep | 配色,比例,强调色,面积
  A-04  | deep | ai味,ai 味,模板,禁用,渐变,eyebrow
  A-05  | deep | 留白,间距,构图,对齐
  A-06  | deep | 动效,动画,签名动作
  A-07  | deep | 渐变,模糊,玻璃,主题边界
  A-08  | deep | 密度,紧凑,疏密,页面类型取数
-->

本文件的规则只服务两个 stage：20（定方向）和 50（取值打磨）。每条都写成可检查的判据，不写形容词。

来源说明：吸收了 Taste Skill「点子来自主体、字阶少而远、带日期的 tells 注册表、截图评审」的方法，并按 Lobe 主题改写。Taste 的 house rules（全面禁渐变、禁阴影、禁 1px 边框、禁玻璃）**不照搬**，因为它们和 LobeUI 的表面体系冲突（见 A-07）。

## A-01 方向卡

方向来自 00 brief 的主体事实，而不是品类惯例。一张方向卡必须回答：

| 字段 | 判据 |
| --- | --- |
| 方向一句话 | 包含至少一个只属于这个主体的名词 |
| 来源 | 指向 brief 主体事实的编号 |
| 竞品替换测试 | 把 Logo 换成竞品后，方向不成立 |
| 记忆点 | 一个画面或一句话，访客离开后能复述 |
| 签名动作 | ≤ 1 个，说得出它解释了什么 |

两个候选方向必须在**构图或字阶**上不同，而不只是换了一套配色。

## A-02 字阶：少而远

- 一页 ≤ 5 档字号；控制台 ≤ 4 档（标题 / 行标题 / 正文 / 辅助）。lint：`LOBE-FONT-SIZE-SCALE`（单文件 > 5 档，或比值 < 1.15 的相邻档 ≥ 3 对）。
- 视觉页：display ÷ body ≥ 3；相邻两档之差 ≥ 1.25 倍。出现 16/18/20/24/28 这种相邻档位挤在一起的字阶，判为失败。
- 大字不一定要粗：先用尺寸和留白拉开层级，再考虑字重。一页字重 ≤ 3 种（常用 400 / 500 / 600）；800+ 的粗黑只留给 display。
- 字距：中文正文和标题不加字距；display 级西文标题可以收紧到 −0.01 ~ −0.03em。加宽字距（≥ 0.05em）一律视为 eyebrow 式装饰。lint：`LOBE-LETTER-SPACING`。
- 行高：正文 1.6–1.75（中文），标题 1.2–1.35，控制台表格行 1.5；不要全局一个值。
- 标题末行不留孤字；正文行宽 ≤ 75 字符（中文约 35–40 字）。
- 字体由主题提供（`theme.css` 的 `fontFamily`）。需要展示型字体时走 `customFonts`，组件里不写 `font-family`（lint：`LOBE-FONT-FAMILY`）。

## A-03 配色比例

- 先说比例，再说颜色：底色约 70%，支撑色约 25%，强调色 ≤ 5%。
- 强调色只出现在说得出名字的位置：主 CTA + 至多两个细节。一屏内品牌实色加品牌渐变合计 ≤ 3 处（同 K-01）。
- 中性灰阶走 `colorText*` / `colorFill*` / `colorBg*`；状态色从基础 token 派生（D-03）。
- 暗色模式靠 `cssVar` 自动处理，不写分支；满饱和品牌色在暗色下降低 20–30% 饱和度。

## A-04 反 AI 味禁用清单（带日期，2026-10 版）

`L` = `lint-lobe.mjs` 能机械识别；`V` = 需要看截图判断。命中即改；确实需要保留的，按 learnings 流程登记豁免和理由。

| # | 模式 | 检出 | 改法 |
| --- | --- | --- | --- |
| A-04.1 | 紫 / 靛 / 蓝紫渐变作为起手式（hero、按钮、光晕） | L `LOBE-PURPLE-GRADIENT` | 中性底 + 一个强调色；品牌时刻用 `gradientAnimation` |
| A-04.2 | 渐变填充的标题文字（`background-clip: text`） | L `LOBE-GRADIENT-TEXT` | 实色；强调靠字号和字重 |
| A-04.3 | 每个标题上方都有一行小号大写字距标签（eyebrow / kicker） | L `LOBE-EYEBROW` | 删掉，或并入标题 |
| A-04.4 | 三张等大功能卡（圆角方块里放图标 + 标题 + 一句话） | V | 按 brief 论证组织区块；用真实界面片段 |
| A-04.5 | 居中大标题 + 副标题 + 两个按钮 + 下方一张截图的首屏 | V | 以方向卡的记忆点为主角 |
| A-04.6 | emoji 当图标或列表符号 | L `LOBE-EMOJI-ICON`（WARN） | `lucide-react` + `Icon`，或 `@lobehub/fluent-emoji` 的语义场景 |
| A-04.7 | 普通卡片也加 `backdrop-filter` 做玻璃效果 | L `LOBE-BLUR-CARD`（WARN） | 模糊只给浮层和贴顶表面（K-04） |
| A-04.8 | 弹跳、过冲缓动；每个区块都淡入上移 | L `LOBE-BOUNCE` / `LOBE-MOTION-DURATION` | ≤ 1 个签名动作；其余不做入场动画 |
| A-04.9 | 发光按钮、彩色光晕阴影（0 偏移的彩色 box-shadow） | L `LOBE-GLOW` | 阴影按档位；按钮用实色 |
| A-04.10 | 假数据看板 hero（灰条 + 甜甜圈图） | V | 真实界面片段，或者不放图 |
| A-04.11 | 标题前的「New / Beta / Introducing」药丸徽章 | V | 写进辅助句 |
| A-04.12 | 「Lorem ipsum」「示例数据」「功能名称」等占位文案 | L `LOBE-PLACEHOLDER-COPY` | 贴近真实业务、长度相近的数据 |
| A-04.13 | 奶油底色 + 陶土 / 铁锈色强调（2025–26 年流行的「温暖编辑风」） | V | 从主体本身找温度：照片、深色墨水、低彩度石色 |
| A-04.14 | 卡片 / 告警左侧 > 1px 的彩色竖条 | L `LOBE-SIDE-STRIPE`（WARN） | `Alert` 的 type；或用图标 + 文字表达状态 |
| A-04.15 | 区块编号 01 / 02 / 03，而顺序本身不承载信息 | V | 删掉编号 |

## A-05 构图与留白

- 首屏只有一个焦点（一秒测试：看一眼，能说出一个词或一个画面）。
- 眯眼测试：页面应该缩成 2–3 块大小明显不同的色块；如果是很多块差不多大的，说明没有主次。
- 文本块的左对齐线 ≤ 3 条，而且是有意复用的。
- 区块之间的间距 ≥ 区块内部最大间距的 2 倍；标题上方的留白大于下方。
- 间距只取 4 的倍数网格（0 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96），外加 1 / 2 / 6 三个细调值；13px、18px 这类值视为「没对齐网格」。lint：`LOBE-SPACING-OFFGRID`。
- 空白是有意的「留白」，不是删掉装饰后留下的「空洞」。
- 控制台：遵守 K-09 密度。不追求大留白，追求按 brief 的决定排出主次。

## A-06 签名动效

- 每页最多一个签名动作，并且能说出它解释了什么（例如：消息流式出现，在解释「AI 正在生成」）。
- 其余元素：只保留 hover / press / 状态切换这类反馈型动效，≤ 300ms，只动画 `transform` / `opacity`。动画 width / height / top / margin 判为失败（lint：`LOBE-ANIMATE-LAYOUT`）。
- 动效走 `ConfigProvider` 注入的 motion 运行时；尊重 `prefers-reduced-motion`（lint：`LOBE-REDUCED-MOTION`——文件里有 `@keyframes` / `animation` 却没有任何 reduced-motion 处理）。

## A-07 Lobe 兼容边界（Taste 规则在 Lobe 下的改写）

| Taste 原规则 | Lobe 版 |
| --- | --- |
| 禁止一切渐变 | 禁止紫蓝起手渐变和渐变文字；`gradientAnimation` 允许用于品牌时刻，**一页 ≤ 2 处** |
| 禁止阴影 | 阴影按档位使用：浮层 > 卡片 > 平面；不使用彩色光晕 |
| 禁止 1px 边框 | 允许 `colorBorderSecondary` 1px 描边和表格行线；禁止 > 1px 的彩色侧边竖条 |
| 禁止玻璃效果 | `blur`（10px）只用于贴内容滚动的表面，`blurStrong`（36px）只用于浮层，普通卡片不加 |
| 禁止 monospace | 代码、ID、数值允许用 `fontFamilyCode`；不把 monospace 当作「技术感」装饰 |
| 页面至少 4 张真实图片、至少 8 个动效元素 | 不采用。控制台不需要图片；视觉页的图片数量由论证决定 |

## A-08 视觉密度（按页面类型取数）

密度不是感觉，是三个可数的量：**一屏焦点数、相邻区块间距、每行信息单元数**。

| 页面类型 | 一屏焦点 | 区块间距 | 正文字号 | 典型行高 / 行距 |
| --- | --- | --- | --- | --- |
| 品牌 / 落地页 | 1 | 96–160px | 16–18px | 1.7 |
| 作品集 / 活动页 | 1–2 | 64–128px | 15–17px | 1.7 |
| 产品控制台 | 主任务区 1 + 辅助 ≤ 2 | 16–24px | 14px | 表格行 40–48px |
| 数据看板 | 指标层级 ≤ 3 档 | 12–16px | 12–14px | 卡片内 8–12px |
| 表单 / 工作流 | 当前步骤 1 | 24–32px（分组） | 14px | 字段间 16–24px |

- 同一屏不要混两种密度：控制台里插一块落地页式的大留白 hero，或落地页里塞一张控制台表格，都判为「像另一个品类」。
- 卡片墙检查：同尺寸卡片 ≥ 6 张且没有一张承担主任务，就是等权重平铺（A-04.4 / K-09）。

## A-09 LobeUI 兼容速查（写样式前先看这一张）

| 想要 | 用 | 不用 |
| --- | --- | --- |
| 颜色 | `cssVar.colorText*` / `colorFill*` / `colorBg*` / `colorPrimary` | 裸 hex / rgba（`LOBE-RAW-COLOR`） |
| 字体 | 主题提供（`theme.css`）；代码用 `cssVar.fontFamilyCode` | 组件里写 `font-family`（`LOBE-FONT-FAMILY`） |
| 圆角 / 阴影 | `cssVar.borderRadius*`、`boxShadow*` 档位 | 自造阴影、彩色光晕（`LOBE-GLOW`） |
| 品牌时刻 | `gradientAnimation`，一页 ≤ 2 处（`LOBE-GRADIENT-ANIMATION-OVERUSE`） | 紫蓝渐变（`LOBE-PURPLE-GRADIENT`）、渐变文字 |
| 玻璃 | `blur` 贴顶表面、`blurStrong` 浮层 | 普通卡片 `backdrop-filter`（`LOBE-BLUR-CARD`） |
| 响应式 | `responsive.*` 断点、`max-width` | 写死 ≥ 480px 宽（`LOBE-FIXED-WIDTH`） |
| 主 CTA | 一屏一个 `type="primary"` | 多个 primary 并列（`LOBE-MULTI-PRIMARY`） |
| 图标 | `lucide-react` + `Icon` | emoji 当图标（`LOBE-EMOJI-ICON`） |

完整规则 → 机械检查对照表见 `node scripts/lint-lobe.mjs --rules`。

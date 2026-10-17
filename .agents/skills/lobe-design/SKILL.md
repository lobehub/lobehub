---
name: lobe-design
version: 5.4.2
description: >
  Single entry for LobeHub UI design work. Routes any instruction — macro ("重做这个后台", "整体打磨一下"),
  medium ("把列表页的交互和空态补齐") or fine ("这个按钮颜色不对", "修 K-07") — into a business-first, layered
  pipeline of focused stages: 00 brief → 05 init → 10 decode → 20 direction → 30 structure → 40 flow →
  50 visual → 60 system → 70 detail → 75 copy → 80 review. Covers seven scenarios: 0→1 visual pages (landing /
  portfolio / campaign), polishing existing product UI, admin consoles / dashboards / forms / workflows,
  design-system unification, screenshot restoration, pre-launch audit, and project bootstrap (AGENTS.md).
  Grounded in classic analysis models (double diamond, Gestalt, Nielsen heuristics, Kano, peak-end, Fogg,
  journey map, cognitive load) and in a layered component boundary: take atoms from @lobehub/ui,
  build business composites yourself. Built on @lobehub/ui, @lobehub/ui/form, @lobehub/ui/pro-table, cssVar
  tokens, @lobehub/charts / icons / fluent-emoji / streamdown, with runnable lint, route, refs and
  bootstrap checks; in-product UI copy by product profile (consumer / SaaS / admin / developer), with
  zh-CN typography. Trigger on lobe-design, lobe-ui, lobehub, LobeChat UI, 控制台, 后台, 看板, 落地页, 官网,
  截图还原, 设计稿, 设计系统统一, 打磨, polish, refine, 审查, 上线前检查, 组件选择, 设计准则, AI 味, 文案, 措辞, 中英文空格, 初始化, AGENTS.md.
---

# lobe-design

一个入口，按需展开。本文件只负责四件事：**先理解业务、识别场景、决定跑哪些 stage、规定每一步的输出**。具体规则在 `stages/` 和 `references/` 里，进入某个 stage 时才读取，不要一开始就全部读完。

**宿主项目已安装时**：把 `.agents/ux/product.md`（产品画像与适用性）和 `.agents/ux/components.md`（组件用法）当作本 skill 的一等输入——**先读它们，再进 stage**。没有这两份时，先跑 `05-init`（装完 / 升级后也应重跑）。

## 为什么这样分层

一次把重构、交互、视觉、文案全想一遍，注意力会被稀释：调间距时还在纠结项目是否符合 LobeUI 架构。之前把 pipe 拆得很细，结果又只有精细指令能命中，宏观指令就失灵了。所以这里只用一个路由入口，下面挂十个粗粒度 stage：

- **宏观指令** → 识别场景 → 跑该场景的默认 pipeline
- **中等指令** → 只跑被点名的 2–3 个 stage，顺序不变
- **精细指令** → 直达单个 stage，并做一次范围内自查

每个 stage 只回答一个问题、只加载自己白名单里的 reference，看到别的问题只记一行 `遗留 → <stage>`。**LobeUI 架构的硬规则交给 `scripts/lint-lobe.mjs` 兜底**，所以视觉、流程、细节这几个 stage 不需要把架构规范读进上下文。

## Stage 索引

| Stage | 文件 | 只回答 | 只加载 |
| --- | --- | --- | --- |
| 00 业务理解 | [stages/00-brief.md](stages/00-brief.md) | 给谁、为了哪个决定或任务 | admin-archetypes · models（M-01/04） |
| 05 项目接入 | [stages/05-init.md](stages/05-init.md) | 指南、产品画像与组件盘点在哪；装完/升级后两轮是否完成 | init |
| 10 截图解析 | [stages/10-decode.md](stages/10-decode.md) | 图里的结构和取值分别映射到哪个组件、哪个 token | design（D-02/04/05/11） |
| 20 视觉方向 | [stages/20-direction.md](stages/20-direction.md) | 这一页靠什么被记住 | aesthetics · craft（K-01/04/09） · models（M-05） |
| 30 结构与组件 | [stages/30-structure.md](stages/30-structure.md) | 零件和骨架对不对（**唯一讨论 LobeUI 架构的地方**） | components · ecosystem · design（D-01/06/07） · craft（K-10） |
| 40 流程与文案 | [stages/40-flow.md](stages/40-flow.md) | 看得懂、走得通、顺序服务决定；简化、澄清；该有哪些文案 | admin-archetypes · copy（W-01/02/03/07） · models（M-01/06/08） |
| 50 视觉取值 | [stages/50-visual.md](stages/50-visual.md) | 取值像不像一套系统、有没有 AI 味 | design · craft · aesthetics · ecosystem（E-02） · models（M-02/08） |
| 60 系统统一 | [stages/60-system.md](stages/60-system.md) | 跨页面漂移的盘点、分诊和派发 | design · components（C-03/11） · models（M-02） |
| 70 细节加固 | [stages/70-detail.md](stages/70-detail.md) | 状态、边界、反馈、微文案、a11y、响应式、一致性 | detail-checklist · craft（K-05/07） · copy（W-04/05/06） · models（M-03/07） |
| 75 界面文案 | [stages/75-copy.md](stages/75-copy.md) | 每句话按产品的文案 profile 写准、写一致；中文排版 | copy-core（T-01..09）· copy（W-01..06）· **只读一份** profile：consumer / saas / admin / devtool |
| 80 上线审查 | [stages/80-review.md](stages/80-review.md) | 能否放行；不能就回流到哪个 stage | evaluator · admin-archetypes |

各 stage 的加载白名单在 `scripts/pipeline.json` 中登记，由 `scripts/check-structure.mjs` 校验：一旦某个 stage 引用了不属于它的规则编号（例如 50 引用 `C-*`），校验就会失败。

## 六件贯穿全局的事

这六条不是 stage，而是每个 stage 都要遵守的前提。它们各自的落点都是可校验的资产，不是文字约定。

### 1. 用经典模型分析问题（`references/models.md`，M-）

模型只有一个用途：**把模糊的问题拆成可以回答的问题**。每个模型都挂载到具体 stage，并有必须产出的字段——**不产出字段的模型不要用**，那只是把名字念一遍。

| 模型 | 挂载 | 回答什么 | 必须落到哪个字段 |
| --- | --- | --- | --- |
| M-01 双钻模型 | 00 · 40 | 真正要解决哪个问题、有哪几条解法 | brief 非目标 + 2 个互斥解法候选 → L2 |
| M-02 格式塔原理 | 40 · 50 · 60 | 用户会把这些看成几组 | 分组靠间距和对齐，不靠边框 |
| M-03 尼尔森启发式 | 70 · 80 | 哪里违反已有心智模型 | 七维覆盖表 / 80 归因语言 |
| M-04 Kano | 00 | 哪些信息必备、哪些加分 | 字段的 Kano 属性；「兴奋」不占主区 |
| M-05 峰终定律 | 20 | 记住哪两个瞬间 | 整页一个记忆点（峰）+ 确定的收尾（终） |
| M-06 福格模型 | 40 | 这个动作为什么没被做 | 判断缺 M / A / P，再给改法 |
| M-07 用户旅程地图 | 70 | 跨页面盲点在哪一段 | 掉状态 / 掉上下文 / 重复问 |
| M-08 认知负荷 | 40 · 50 | 用户要同时处理几件事 | 选项 > 7 先分组；区块 > 7 先分层 |

### 2. 组件分层：原子层取用，组合层自建（C-11）

**组件库能覆盖的深度是有限的；越贴近业务语义的组合，越该由项目自己构建。**

| 层 | 例子 | 怎么办 |
| --- | --- | --- |
| 原子层 | `Button` `Input` `Modal` `Table` `Tag` | **必须**从 `@lobehub/ui` 取用（C-01 硬性规则，lint 兜底） |
| 皮肤层 | `Block` `Surface` `ConsoleShell` `PageHeader` | 用 lobe-ui / dashboard 现成的 |
| 组合层 | 会话区、消息体、工作流画布、业务卡片簇 | **优先自建**，用原子层 + 皮肤层拼 |
| 领域层 | Agent 会话、模型调用、审批流 | **必须自建** |

判据：布局由业务语义决定 → 自建；需要跨页复用 → 自建一个项目内组件；只是为了外观相近 → 用现成件。
反过来，把 `Table` / `Modal` / `Input` 在项目里重写一遍同样是错的（`LOBE-REIMPLEMENT-ATOM`）。
自建件内部只能用原子层和皮肤层，取值仍走 `cssVar`，并且**不要改 lobe-ui 源码**。`chat` 系列是这条边界的参照实现。

### 3. 项目接入与两轮自迭代（`stages/05-init.md`，`scripts/bootstrap.mjs`，`scripts/project-scan.mjs`）

**装完或升级后先跑 05**（或对 Agent 说「初始化 / 升级后刷新」）：

1. **接入**：探测 `AGENTS.md` → `CLAUDE.md` → 都没有就建立，把入口、触发、纪律、自迭代写进托管块（块外一字不改；`--print` 后再写）。
2. **Round 1 产品画像**：`project-scan.mjs` 收集确定性事实 → 写 `.agents/ux/product.md`（平台、产品类型、用户、核心任务、规则适用性、文案 profile）。
3. **Round 2 组件盘点**：扫描项目组件 → 写 `.agents/ux/components.md`（薄包装 / 与 lobe-ui 重复 / 业务组件用法；无实现细节）。

项目层在 `.agents/ux/`，**不进**已安装 skill，重装不覆盖。日常 UI 任务**先读** `product.md` 与 `components.md`，再按 stage 加载。`--check` / `project-scan --check` 发现缺失或过期时重跑两轮。

### 4. 抽象指令先翻译，再动手（`scripts/intent.mjs`）

「体验不好 / 丑 / 难用」这类原话没有可执行内容。路由器会先把它归一化成 **stage + 要说清楚的量**，再并入关注点：

| 原话 | 归一化成 | 进入 |
| --- | --- | --- |
| 体验不好 / 难用 | 还原成一次具体失败：谁 · 在哪一步 · 想做什么 · 卡在哪 | 40 |
| 丑 / 难看 | 先指出是 层级 / 留白 / 字阶 / 配色比例 里哪项不合格 | 50 |
| 太乱 | 分组失败：哪几块被看成一组、哪几块本该分开 | 40 |
| 看不清 | 具体元素 + 明暗 + 对比度期望值 | 50 |
| 找不到 | 路径缺口：想做什么、在哪一层找不到入口 | 40 |
| 太慢 / 卡 | 状态缺失：300ms / 2s / 10s 三档有没有处理 | 70 |
| 感觉不对 / 说不上来 | **归一化不了 → 先追问**（`granularity: clarify`），不猜着动手 | — |

### 5. refs 渐进式披露（`scripts/refs.mjs`）

**不要把当前场景无关的内容塞进上下文。** 每份 reference 顶部的 `refs:meta` 块声明 `tier` 和条目：

- `tier: flat` → 文件小，整份加载。
- `tier: index` → 只加载 `always` 条目 + **命中本次指令**的 `deep` 条目；其余只读标题，需要时按 id 单独展开。
- `tier: profile` → 互斥分支，只读被选中的一份。75-copy 的四份文案 profile 按 `--profile` → `product.md` 的 `copy-profile:` → 指令里的触发词选择；都没有就先问。
- `components.md` 是 48KB，但一次任务通常只命中 C-01 + 2–3 条；不要整份读。

```bash
node scripts/refs.mjs "<指令原文>"          # 每个 stage 该读哪些条目
node scripts/refs.mjs "<指令>" --stage 75-copy --root <项目根>   # 75 只读 product.md 选中的 profile
node scripts/refs.mjs --audit               # 审计 tier 划分与 always 预算
```

### 6. 回流上游（`CONTRIBUTING.md`，`scripts/upstream.mjs`）

本 skill 托管在 <https://github.com/lobehub/lobe-design-skill>。消费方把**通用经验**回流上去，回流前先过机械自检：

`node scripts/upstream.mjs` 只放行同时满足六条的条目：`landed` 且带版本 · 层在 `structure/lint/rule`（style 不回流）· `occurrences ≥ 2` · 不含品牌或项目专有名词 · symptom / root_cause / artifacts 齐全 · 不是组件问题（组件 bug 与绕法归 lobe-ui）。
回流的是**判据**（可校验的规则、可复用的契约），不是某个项目的具体取值。

## 第一步永远是业务（00）

**所有 pipeline 都从 00 开始，不能跳过；能变的只是深度。** brief 的字段（主任务、关键决定、决定所需信息、危险操作、密度倾向）是后续每个 stage 的必需输入：

- 20 / 50 按「决定所需信息」分配视觉权重，按「密度倾向」定紧凑程度
- 30 按「原型」选骨架，按「决定所需信息」排区域顺序
- 40 按「主任务 / 关键决定」排优先级，按「危险操作」定确认强度
- 70 按「对象生命周期 / 危险操作」确定必须覆盖哪些状态
- 75 按「页面类型 / 危险操作」和 `product.md` 的文案 profile 定措辞与确认强度
- 80 用「主任务」核对两条阻断项：主任务不明、主路径断裂

深度由路由决定：宏观指令出完整 brief（archetype / subject / reverse / scope 模式），打磨场景出一段压缩版，中等和精细指令出一行 `lite`（`页面类型 · 主任务 · 密度倾向`）。已有 brief 时直接复用，不重写。

## 路由

### 1. 先跑路由器（确定性，可复现）

```bash
node scripts/route.mjs "<用户指令原文>"            # 人读
node scripts/route.mjs "<用户指令原文>" --json     # 机读
node scripts/route.mjs "<指令>" --has-brief        # 已有 brief 时，00 改为复用
```

路由器读取 `scripts/pipeline.json`，输出场景、颗粒度、有序的 stage 列表和每个 stage 要加载的文件。路由器的结果是默认值；结合对话上下文明显不合理时可以调整，但要在输出里说明理由。

### 2. 场景识别（按优先级从上到下，命中即停）

| 场景 id | 场景 | 识别信号 | 默认 pipeline |
| --- | --- | --- | --- |
| `bootstrap` | 项目接入 / 初始化 | 初始化、接入、bootstrap、agents.md、产品画像、组件盘点、升级后刷新 | 00(project) → 05（托管块+两轮）→ 自查 |
| `screenshot-restore` | 截图 / 设计稿还原 | 截图、还原、设计稿、figma、照着 | 00(reverse) → 10 → 30 → 50 → 70 → 80(compare) |
| `pre-launch` | 上线前审查 | 上线前、能不能上线、验收、audit、放行 | 00(reuse) → 80(audit) → 回流 ≤3 条 → 80 确认一轮 |
| `system-unify` | 设计系统统一 | 设计系统、统一、不一致、token、收敛、normalize | 00(scope) → 60 → 30 → 50 → 80 |
| `launch-visual` | 0→1 视觉型页面 | 落地页、官网、首页、作品集、活动页、发布页 | 00(subject) → 20 → 30 → 50 → 70 → 80(critique) |
| `operate-build` | 后台 / 看板 / 表单 / 工作流 **新建或重做** | 后台、看板、控制台、表单、工作流、审批 **且** 新建、重做、从零 | 00(archetype) → 40(规划 L1–L6) → 30 → 50 → 70 → 75 → 80 |
| `product-polish` | 已有产品迭代打磨 | 打磨、polish、refine、优化、改版；或者是后台类信号但没有新建信号 | 00(compressed) → 40 → 50 → 70 → 75 → 80 |

区分要点：
- **bootstrap 和 product-polish**：前者写的是项目配置（`AGENTS.md` 托管块），不含任何界面改动；信号具体，优先级最高。
- **operate-build 和 product-polish**：区别在于有没有新建或重做的信号。打磨已有后台不重审架构（不跑 30），只有其他 stage 记了 `遗留 → 30` 时才插入 30。
- **launch-visual 和 product-polish**：前者是从 0 到 1 的视觉型页面，需要 20 定方向；后者沿用现有视觉，只在 50 打磨取值。已有的官网 / 落地页只带打磨信号（「打磨一下官网」）、没有新建或重做信号时，按 product-polish 处理，不重定方向。
- **system-unify 和 product-polish**：前者跨页面，先由 60 盘点再派发；后者是单页。
- **pre-launch** 只记录、不修，修复通过回流完成。

### 3. 颗粒度

| 颗粒度 | 判定 | 跑什么 |
| --- | --- | --- |
| **宏观** | 识别出场景，且（有「整体 / 重做 / 从零」类信号，或没有点名具体关注点，或点名的关注点 ≥ 4 个，或只点名了该场景的锚点 stage） | 该场景的默认 pipeline |
| **中等** | 点名了 2–3 个 stage 的关注点 | `00 lite` + 被点名的 stage，按 stage 编号排序 |
| **精细** | 只点名了 1 个 stage 的关注点，或点名了规则编号 | `00 lite` → 该 stage → 自查（lint + 该 stage 清单，不做完整 80 评分） |
| **模糊** | 既没有场景，也没有关注点（例如「看看这个页面」） | 不执行；给出 2–3 条路径供用户选择 |
| **追问** | 只有抽象说法、归一化不出可执行内容（例如「感觉不对」） | 不猜着动手；先问清「哪个页面、哪个状态、期望什么、实际什么」 |

规则编号（`C-` `D-` `K-` `E-` `P-` `A-` `W-` `M-` `T-` 两位编号，`X-n.n` 清单项）按 `pipeline.json` 的 `ruleOwners` 直达所属 stage；脚本报出的 `LOBE-*` / `DETAIL-*` 按脚本自己登记的 `stage` 直达（`DETAIL-*` → 70）。**点名了编号时以编号为准**，指令里的其他关键词只记录、不参与路由（例如「LOBE-RAW-COLOR 报错」进 50，不因「报错」进 70）。

完整设计理由、三类指令的逐步路由演练见 [docs/REFACTOR_NOTES.md](docs/REFACTOR_NOTES.md)（给维护者读，执行时不需要加载）。

### 4. 执行纪律

1. **一次只进一个 stage。** 进入时才读该 stage 文件及其「只加载」列出的条目；做完输出交接，再进下一个。
2. **按需加载条目，不整份读 reference。** 先跑 `node scripts/refs.mjs "<指令>"`，只读它列出的 `always` + 命中条目；需要别的条目时按 id 单独展开。
3. 上一 stage 的「遗留」是下一 stage 的输入之一。遗留如果指向已经跑过的 stage，就留到 80 回流时处理。
4. 某个 stage 确认无事可做时，用一句话说明后跳过，不要硬找问题。
5. 凡是改了代码的 stage，结束前都要跑 `node scripts/lint-lobe.mjs <改动路径>`，FAIL 必须修。
6. 回流最多一轮；仍未通过就停下，报告卡在哪里。

## 输出契约

每个 stage 结束时输出：

```
[<stage> · <名称>] 完成
输入引用：brief.<字段>，<上游 stage 的产出>
改动：<文件 / 区域 —— 一句话，带规则编号>
脚本：<命令 + RESULT 行>（没有改代码时写「--」）
遗留：<问题 → stage 编号>（只能指向别的 stage）
缺口：<D-11 格式，没有写「无」>
```

整个任务结束时输出汇总：

```
[lobe-design] 场景：<id>　颗粒度：<宏观|中等|精细>　Pipeline：00 → … → 80
brief：<一行摘要>
各 stage 改动：…
未解决遗留 / 缺口：…
学习候选：<本次被用户纠正的地方 → `node scripts/check-learnings.mjs --new` 生成条目，按 learnings/README.md 选层回写>
```

## 资产目录（都由本入口按需引用，不是独立的 skill）

```
skills/lobe-design/
├─ SKILL.md                 唯一入口：路由 + 契约 + 六件贯穿全局的事
├─ stages/                  11 个 stage，每个都有 聚焦 / 不负责 / 输入 / 只加载 / 检查清单 / 输出
├─ references/              规则库：components(C) design(D) craft(K) ecosystem(E) admin-archetypes(P)
│                           aesthetics(A) copy(W) copy-core(T) copy-<profile>(T，四选一) detail-checklist(X)
│                           models(M) init(I) evaluator
│                           每份顶部有 refs:meta 块（tier / scope / entries），供渐进式披露解析
├─ scripts/
│  ├─ pipeline.json         路由、隔离与抽象指令归一化的唯一事实源
│  ├─ route.mjs             指令 → 场景 / 颗粒度 / stage 序列 / 加载清单
│  ├─ refs.mjs              渐进式披露：每个 stage 到底该读哪些条目（+ --audit）
│  ├─ intent.mjs            抽象指令翻译：体验不好 / 丑 / 难用 → 可执行表述 + 要说的量
│  ├─ bootstrap.mjs         项目接入：探测并维护 AGENTS.md 托管块（幂等，块外不改）
│  ├─ upstream.mjs          消费方回流：挑出通用、无品牌印记的经验条目
│  ├─ lint-lobe.mjs         架构 + 视觉 + a11y + 文案的静态检查（FAIL/WARN，可写理由豁免）
│  ├─ check-detail.mjs      状态 / 反馈覆盖启发式（loading / error / retry / empty / pending / 结果反馈 / 危险确认 / 禁用原因 / 输入 label）
│  ├─ check-structure.mjs   单入口、stage 契约、规则白名单隔离、悬空编号、场景映射、refs:meta
│  └─ check-learnings.mjs   自进化闸门：经验日志格式、回写约束 L-01..L-06、规则 ↔ 回归 ↔ 版本一致
├─ tests/                   路由用例 + lint / detail / learnings / refs / bootstrap 正反例，`node tests/run.mjs`
├─ learnings/               结构化经验日志（LOG.md）+ 回写流程与版本化策略（README.md）
├─ CONTRIBUTING.md          回流上游的判据与流程
├─ docs/REFACTOR_NOTES.md   维护者文档：设计理由、架构图、三类指令路由演练（执行时不加载）
└─ CHANGELOG.md             规则版本（每条 lint 规则带 since）
```

本地运行：需要 Node ≥ 18，零依赖。在 skill 目录下执行 `node tests/run.mjs`，即可一次跑完结构校验、路由回归、lint / detail 回归、refs 披露、bootstrap 幂等、learnings 闸门和脚本 CLI 契约。所有脚本都支持 `--help`，退出码 0 通过 / 1 FAIL / 2 用法错误。

## 与参考技能的关系

- 吸收了 Taste Skill 的方法：0→1 视觉页「点子来自主体」、字阶少而远、带日期的反 AI 味清单、截图评审。这些分别落到 00 的 subject 模式、20、`aesthetics.md` 和 80 的 critique 模式，并按 Lobe 主题改写（A-07）。
- 吸收了 Impeccable 的方法：audit / critique / polish / simplify / normalize / harden。它们没有做成独立命令，而是收敛为 stage 内部的焦点清单：audit → 80，polish 分诊 → 60，simplify / clarify → 40，normalize → 60，harden / adapt → 70。
- 参考了 [Tech-Doc-Style-Chinese](https://github.com/Fenng/Tech-Doc-Style-Chinese)（MIT，Fenng）的结构与经验：规则优先级、事实保真、中西文留白、标点、数字单位、状态词不机械直译、按任务读取参考。改写后落到 75-copy 与 `copy-core.md`，只覆盖界面短文案；长篇文档仍请直接使用原 skill。
- **色板调参不在本目录**：换品牌 / primary、定制企业色板、重调状态色或色阶时，去 lobe-ui 的 [`tuning-color-palettes`](https://github.com/lobehub/lobe-ui/tree/master/.agents/skills/tuning-color-palettes)（本机已安装则按技能名调用）。本 skill 的 D-07 / 50-visual 只指向它，不复制其流程。
- 上述方法类参考没有作为独立 skill 拷进本目录；本目录只有这一个 `SKILL.md`。色板调参 skill 住在 lobe-ui 仓库，按需查阅。

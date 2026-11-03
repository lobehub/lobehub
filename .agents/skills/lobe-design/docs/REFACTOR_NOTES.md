# REFACTOR_NOTES：lobe-design 2.x 重构说明

> 读者：维护这个 skill 的人。执行任务时 Agent **不需要**加载本文件。入口始终是 `../SKILL.md`。
> 对应版本：2.1.2（2026-10-14）。原版本（1.x，HEAD `6653166`）已备份在 `.backup/20261014-141721-pre-pipeline-refactor/`，git tag 为 `backup/pre-pipeline-refactor-20261014-141721`。

## 目录

1. 现状问题诊断（1.x）
2. 设计目标与约束
3. 架构：单入口 + 分层 pipeline（含架构图）
4. Stage 颗粒度的取舍：为什么是 9 个，为什么不能更细
5. 路由规则
6. 业务优先：00 brief 的输入、输出和下游引用
7. 场景 → pipeline 映射
8. 审美与体验细节放在哪一层
9. 自进化机制：经验沉淀、回写、版本化
10. 规则脚本化：哪些写进了代码
11. 与 Taste Skill / Impeccable 的对照：借鉴了什么，哪些没有照抄
12. 路由演练：宏观、中等、精细三类真实指令
13. 本次（2.1.1）修正的不一致
14. 最终文件结构与命令
15. 已知局限与后续方向

---

## 1. 现状问题诊断（1.x）

诊断对象：重构前的 `skill/SKILL.md`（104 行）、`stages/00-business … 04-review`，以及 `projects/` 下 5 份按项目复制的 SKILL.md（每份 187–315 行）。

| # | 问题 | 证据（1.x 原文或结构） | 后果 |
| --- | --- | --- | --- |
| P1 | **关注点没有真正隔离** | `03-polish.md` 的「按需加载的规则」包含 `C-08 控制台：按场景选组件`；`SKILL.md` 把「硬性前提（任何阶段都成立）」写在入口 | 调视觉细节时，组件选型和 LobeUI 架构规范仍在上下文里，占用注意力（用户的核心痛点，也记在 `learnings/LOG.md` 的 LRN-20261014-01） |
| P2 | **02 阶段负担过重** | `02-interaction` 同时负责：层级、主路径、状态、反馈、可访问性、文案、空值 | 宏观指令里，状态和 a11y 总是排在路径和文案后面，常被挤掉 |
| P3 | **场景只有三种** | 路由表只区分「已有界面整体优化 / 新建页面 / 审一下」 | 0→1 视觉页被交给外部 skill `building-landing-home`；截图还原、设计系统统一没有专门的流程 |
| P4 | **业务步骤可以跳过** | `00-business`：「纯视觉、纯文案、指名了规则编号的修复 → 跳过本阶段」 | 精细指令没有任何业务锚点，「这个按钮颜色」无法判断该不该是主色 |
| P5 | **模糊地带靠一句话裁决** | 「拿不准时：同时出现两个以上阶段的关注点，按宏观处理但只跑被点到的阶段」 | 宏观、中等的边界不可复现；同一句话两次路由结果可能不同 |
| P6 | **规则只存在于文字里** | 无脚本、无 lint、无回归用例；`components.md` 引用了不存在的 `K-16` | 规则漂移、悬空编号没人发现；同一个错会以别的形式再犯 |
| P7 | **没有沉淀机制** | 无 learnings、无 CHANGELOG、无版本号 | 用户的纠正只存在于当次对话 |
| P8 | **多份入口** | `projects/*/SKILL.md` × 5 + `skill/SKILL.md` | 实际上是 6 个 skill，规则在各份之间不同步 |
| P9 | **缺审美层** | craft.md 只有 AI Slop 反模式，没有字阶、配色比例、构图、密度取数 | 能挡住「明显的 AI 味」，但给不出「应该怎样」 |

另外，用户还描述过一次更早的尝试（git `1043936` 之后的细拆版本）：把 pipe 拆得很细之后，只有「优化这块文案」这类非常具体的指令能命中对应 pipe，「整体打磨一下」这类宏观指令就失灵了。这是第 4 节颗粒度取舍的直接依据。

## 2. 设计目标与约束

参考过的两个仓库（3.0.1 时已从工作区清理，按需重新 clone）：

| 仓库 | 当时版本 | 借鉴了什么 |
| --- | --- | --- |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | `a60a36d` | 主体事实驱动的方向、带日期的反 AI 味清单、正反例 fixture、`install.sh` + `skills/<name>/` 布局 |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `2f98774f8` | polish 四分类（分诊 / 归一 / 提取）、audit 体检、命令收敛为 stage 焦点 |
| `vibe-designing-playbook.md` | — | references 是「声明」、SKILL.md 是调度契约、80 是验收契约的三层对应 |

本项目**没有**照抄的部分及原因见第 11 节。

1. **单一 skill**：一个 `SKILL.md`，其余全部是它按需引用的子目录。`check-structure.mjs` 的 `single-entry` 会强制检查（忽略 `temp/` 第三方参考和 `.backup/` 归档）。
2. **注意力隔离**：每个 stage 只回答一个问题，只加载白名单里的 reference，看到别的问题只记一行 `遗留 → <stage>`。
3. **宏观、精细都能命中**：路由要确定、可复现，并且有回归用例锁住。
4. **业务优先**：00 不能跳过，只能变浅。
5. **写进代码优先于写进提示**：能被确定性校验的，就做成脚本、闸门或回归用例（见第 10 节）。
6. **兼容 LobeUI**：审美规则必须能映射到 `cssVar` token 和 Lobe 主题，不能引入另一套设计系统。

## 3. 架构：单入口 + 分层 pipeline

```
                          用户指令（原文）
                               │
                               ▼
┌─────────────────────────── SKILL.md（唯一入口）───────────────────────────┐
│  L0 路由 / 编排层                                                         │
│   node scripts/route.mjs "<指令>"  ← 读取 scripts/pipeline.json（唯一事实源）│
│   ① 点名规则编号？ ──是──► 直达所属 stage（精细）                            │
│   ② 场景识别（6 类，按优先级）                                              │
│   ③ 颗粒度：宏观 / 中等 / 精细 / 模糊                                        │
│   ④ 生成有序 stage 列表 + 每个 stage 的加载清单                               │
│  输出契约：每个 stage 交接 → 汇总 → 学习候选                                  │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  一次只进一个 stage，进入时才读文件
    ┌───────────────────────────┼──────────────────────────────────────┐
    ▼                                                                   │
┌────────┐  brief（必需输入）                                           │
│00 brief│──────────────┬──────────────┬──────────────┬──────────┐    │
└────────┘              ▼              ▼              ▼          ▼    │
  L1 业务层   ┌──────────┐   ┌──────────────┐  ┌──────────┐ ┌────────┐ │
              │10 decode │   │20 direction  │  │40 flow   │ │60 system│ │
  L2 规划层   │截图→清单 │   │方向卡(视觉页)│  │层级/路径/│ │漂移盘点 │ │
              └────┬─────┘   └──────┬───────┘  │文案/L1–L6│ │→派发    │ │
                   │                │          └────┬─────┘ └───┬────┘ │
                   ▼                ▼               ▼           ▼      │
  L3 构建层   ┌───────────────────────────────────────────────────┐    │
              │30 structure：组件 / 骨架 / 导入（唯一谈 LobeUI 架构处）│    │
              └──────────────────────────┬────────────────────────┘    │
                                         ▼                             │
  L4 打磨层   ┌──────────────────────┐   ┌───────────────────────────┐ │
              │50 visual：取值/AI 味 │ → │70 detail：七维状态与边界   │ │
              └──────────────────────┘   └───────────────────────────┘ │
                                         ▼                             │
  L5 审查层   ┌────────────────────────────────────────────────────┐   │
              │80 review：audit / critique / compare，只记录不修     │───┘
              └────────────────────────────────────────────────────┘ 回流 ≤3 条、≤1 轮
    ───────────────────────────────────────────────────────────────────────────
  贯穿层（不是 stage，不占 pipeline 位置）：
   scripts/lint-lobe.mjs      39 条规则；每条带 stage，架构硬规则在这里兜底
   scripts/check-detail.mjs   9 条状态 / 反馈启发式（服务 70）
   scripts/check-structure.mjs 单入口、stage 契约、白名单隔离、悬空编号、场景映射
   scripts/check-learnings.mjs 经验日志格式、回写约束 L-01..L-06、规则↔回归↔版本
   tests/run.mjs              一次跑完以上 + 26 条路由回归 + CLI 契约
   learnings/ + CHANGELOG.md  自进化闭环
```

**分层原则**：上层产出是下层的输入，下层不回头改上层，只能记 `遗留 → <上层 stage>`，由 80 回流时统一处理。这样同一时刻只有一个关注点在上下文中。

**为什么架构规范能从 50/70 移走**：LobeUI 的硬规则（导入入口、`createStaticStyles`、Provider 嵌套、`.ant-` 类名…）都能用正则判断，所以由 `lint-lobe.mjs` 在每个改代码的 stage 结束时兜底。50 只需要跑一次脚本、读 RESULT 行，不需要把 `components.md`（48KB）读进上下文。`check-structure.mjs` 的 `isolation:50-visual` 会在 50 引用任何 `C-*` 时报 FAIL。

**每个 stage 的固定契约**（`check-structure.mjs` 的 `contract:*` 检查）：`聚焦 / 不负责 / 输入 / 只加载 / 检查清单 / 输出` 六节缺一不可；`brief-input:*` 检查每个 stage 的「输入」节都引用了 00 brief。

| Stage | 只回答 | 不负责（交给谁） | 只加载 |
| --- | --- | --- | --- |
| 00 brief | 给谁、为了哪个决定 | 组件→30，取值→20/50，状态→70；不写代码 | admin-archetypes（P） |
| 10 decode | 图里的结构和取值映射到哪个组件、哪个 token | 选组件→30；判断美丑→80 | design（D-02/04/05/11） |
| 20 direction | 这一页靠什么被记住 | 组件→30，px→50，**不查架构** | aesthetics（A），craft（K-01/04/09） |
| 30 structure | 零件和骨架对不对（**唯一谈 LobeUI 架构的地方**） | 好不好看→50，流程→40，状态→70 | components，ecosystem，design（D-01/06/07），craft（K-10） |
| 40 flow | 看得懂、走得通，文案，简化 | 组件→30，取值→50，状态逐项加固→70 | admin-archetypes，copy（W-01/02/03/07） |
| 50 visual | 取值像不像一套系统、有没有 AI 味 | **组件选型 / 架构→30**，层级→40，状态→70 | design，craft，aesthetics，ecosystem（E-02） |
| 60 system | 跨页漂移的盘点、分诊和派发 | 动手修改（派给 30/50） | design，components（C-03） |
| 70 detail | 七维：状态、边界、反馈、微文案、a11y、响应式、一致性 | 组件→30，层级→40，取值→50 | detail-checklist（X），craft（K-05/07），copy（W-04/05/06），design（D-09） |
| 80 review | 能否放行；不能就回流到哪 | 审查过程中改代码 | evaluator，archetypes（只读命中的 P-xx） |

## 4. Stage 颗粒度的取舍

### 4.1 三种失败形态

| 颗粒度 | 典型做法 | 失败方式 |
| --- | --- | --- |
| 过粗（1.x 之前） | 一个综合 skill，一次全想 | 注意力稀释：调间距时还在想架构 |
| 过细（用户试过的版本） | 文案 pipe、图标 pipe、间距 pipe、动效 pipe… | 宏观指令无处可去；pipe 之间的交接成本 > 收益；只有措辞贴近 pipe 名的指令能命中 |
| **适中（2.x）** | 9 个 stage，每个对应一类**决策**，而不是一类**属性** | — |

### 4.2 切分判据

一个 stage 成立，需要同时满足以下四条：

1. **一个可回答的问题**：能写成「只回答：……」一句话（见 stage 文件第一行）。
2. **独立的知识依赖**：它需要的 reference 和相邻 stage 明显不同（例如 30 需要 components.md，50 不需要）。这是注意力隔离的物理基础。
3. **独立的产出物**：产出一个下游能直接消费的结构化文件（brief、方向卡、区域清单 + 取值映射、L1–L6、漂移派发表、七维覆盖表、审查报告）。
4. **在至少一个场景的默认 pipeline 中出现**（`check-structure.mjs` 的 `reachable`），否则宏观指令永远到不了它。

### 4.3 具体取舍

| 决定 | 理由 |
| --- | --- |
| **文案不单独成 stage，并入 40** | 文案总是依附于某个决定或动作（按钮动词 = 主任务，确认文案 = 危险操作）。单独拆出来，宏观指令下就没人负责文案。状态类微文案（空态 / 错误 / 占位，W-04/05/06）跟着状态走，放在 70。**5.4.0 修订**：「有哪些文案、讲没讲到要素」仍留在 40 / 70（W- 编号与归属不变）；「怎么说、怎么排」拆成 75-copy，并固定挂在 operate-build / product-polish 的宏观 pipeline 里，所以宏观指令下仍有人负责。拆的理由是措辞依赖产品类型（C 端 / SaaS / 后台 / 开发者平台），四套口吻放进 40 会让每次都读全部；75 用 `tier: profile` 只读一份。 |
| **状态从 1.x 的 02 拆出，成为 70** | P2：和路径放在一起总被挤掉。70 有独立清单（detail-checklist 七维）和独立脚本（check-detail），两个判据都满足。 |
| **20 方向与 50 取值分开** | 方向（这一页靠什么被记住）需要主体事实和反模板清单，取值需要 token 表；两者知识依赖不同。控制台类页面的「方向」就是 Lobe 主题，所以 20 只在视觉页和截图之外的 0→1 场景运行，不会给后台增加负担。 |
| **10 截图解析独立** | 还原的两种失败（逐像素抄 hex、凭印象差不多）都发生在「看图」这一步；先产出一张映射表，30 和 50 照表执行，不再各自回头看图。 |
| **60 只裁定、不动手** | 跨页统一的难点在于「以谁为准」，而不在于替换本身。替换交给 30 / 50，复用它们的隔离。 |
| **图标、动效、间距、配色不单独成 stage** | 它们是同一类决策（取值）的不同属性，共用 design / craft / aesthetics；拆开就是用户试过的过细方案。 |
| **80 不修** | 生成和评估隔离（playbook「隔离系统保护评审对象」），修复通过回流完成，回流最多一轮（「停止规则保护循环」）。 |
| **00 不跳过，只变浅** | 修正 P4：`lite` 模式只要一行 `页面类型 · 主任务 · 密度倾向`，成本很低，但足以让「按钮颜色」这类问题有判断依据。 |

### 4.4 宏观、精细都能命中的关键

不是靠 stage 更多，而是靠**两套独立的信号**：

- **场景信号**（`scenarios.*.signals`）回答「这是什么工作」，决定宏观指令的整条 pipeline。
- **关注点信号**（`stages.*.keywords` + 规则编号）回答「要动哪一层」，决定中等和精细指令跑哪几个 stage。

宏观指令通常只有场景信号，没有关注点，于是跑默认 pipeline；精细指令通常只有关注点，于是直达单个 stage。过细方案只有关注点信号，这就是宏观指令失灵的原因。

## 5. 路由规则

路由完全由 `scripts/route.mjs` + `scripts/pipeline.json` 决定，确定、可复现；26 条回归用例在 `tests/route-cases.json`。Agent 结合上下文可以覆盖路由结果，但必须在输出中说明理由。

### 5.1 算法（按执行顺序）

1. **点名编号**：
   - reference 编号 `C/D/K/E/P/A/W-nn` 和清单项 `X-n.n` → `ruleOwners`（最长前缀优先，例如 `K-07 → 70`，`K-* → 50`）。
   - 脚本编号 `LOBE-*` → 该 lint 规则自己登记的 `stage`；`DETAIL-*` → 70。
   - **点名了编号时，编号说了算**：其他关键词只记录、不参与路由（2.1.1 修正，见第 13 节）。
2. **关注点**：在除 00 外的 8 个 stage 的 `keywords` 中做子串匹配；被更长命中完全包含的短命中丢弃（「视觉方向」不会再算成「视觉」）。
3. **场景**：按 `scenarioPriority` 从上到下，命中即停：
   `screenshot-restore > pre-launch > system-unify > launch-visual > operate-build > product-polish`
   - `operate-build` 需要「后台类信号 **且** 新建信号」；只有后台类信号时落到 `product-polish`。
   - 视觉页信号 + 打磨信号 + 无新建信号 → 跳过 `launch-visual`，落到 `product-polish`。
4. **颗粒度**：

   | 条件（依次判断） | 颗粒度 |
   | --- | --- |
   | 点名编号且只指向 1 个 stage | 精细 |
   | 有场景，且（有宏观信号 / 没有关注点 / 只命中该场景的锚点 stage / 关注点 ≥ 4） | 宏观 |
   | 无场景但关注点 ≥ 4 | 宏观（按 product-polish） |
   | 关注点 = 1 | 精细 |
   | 关注点 2–3 | 中等 |
   | 其余 | 模糊（不执行，给 2–3 条路径让用户选） |

5. **生成计划**：
   - 宏观 → 场景默认 pipeline，00 用该场景的 brief 模式（已有 brief 时传 `--has-brief`，改为 `reuse`）。
   - 中等 → `00 lite` + 被点名的 stage，**按 stageOrder 排序**（不按用户提及的顺序）。
   - 精细 → `00 lite` → 该 stage → `@selfcheck`（lint + 本 stage 清单，不做完整 80 评分）。

### 5.2 为什么用锚点 stage

「落地页的首屏没有记忆点」只命中 20，看起来像精细指令；但 20 是 launch-visual 的**锚点**，方向一变，骨架、取值、响应式都要跟着变，所以按宏观处理。锚点表：`screenshot-restore→10`、`pre-launch→80`、`system-unify→60`、`launch-visual→20`。

### 5.3 执行纪律（SKILL.md「执行纪律」）

一次只进一个 stage；遗留指向已跑过的 stage 时留给 80 回流；无事可做就一句话跳过；改了代码必须跑 lint 且 FAIL 必修；回流最多一轮。

## 6. 业务优先：00 brief 的输入和输出

**输入**：指令原文、路由给出的场景和 brief 模式、项目层 `.agents/ux/product.md`（存在时）、路由 / 侧栏 / tRPC / 权限点（读够就停）、截图（还原场景）。

**模式**（按任务大小伸缩）：`archetype`（后台新建）· `subject`（视觉页，额外要求 8–12 条主体事实、竞品替换测试、论证）· `compressed`（打磨）· `reverse`（截图反推）· `scope`（系统统一）· `reuse`（上线前）· `lite`（中等 / 精细，一行）。

**输出字段 → 下游引用**（字段名固定，下游按字段名引用，不重写）：

| brief 字段 | 被谁用 | 用来做什么 |
| --- | --- | --- |
| 主任务、关键决定 | 40 · 80 | 主动作唯一（W-01）；80 的两条阻断项「主任务不明」「主路径断裂」 |
| 决定所需信息（1-2-3） | 30 · 40 · 50 | 区域顺序（30/40）；视觉权重（50） |
| 原型 P-xx | 30 · 40 · 80 | 选骨架；第一屏优先级；「常见错法」对照 |
| 危险操作（可撤回 / 波及面） | 40 · 70 | 确认强度；必须覆盖的状态 |
| 对象生命周期 | 70 | 必须覆盖的状态集合 |
| 页面类型、密度倾向 | 50 | A-08 密度取数；字阶档数 |
| 主体事实、论证、记忆点 | 20 | 方向必须追溯到某条主体事实 |
| 第一视线、层级 1-2-3（reverse） | 10 | 确定主区 |
| 范围、基准页（scope） | 60 | 「以谁为准」 |

**机械保证**：`check-structure.mjs` 检查每个场景的 pipeline 第一步都是 `00-brief`（`scenario:*`），每个 stage 的「输入」都引用 00 brief（`brief-input:*`）；`tests/run.mjs` 检查每条路由结果的第一个 stage 都是 `00-brief`。

## 7. 场景 → pipeline 映射

| 场景 | 识别要点 | Pipeline | 借鉴来源 |
| --- | --- | --- | --- |
| `launch-visual` 0→1 视觉页 | 落地页 / 官网 / 作品集 / 活动页，且非纯打磨 | 00(subject) → 20 → 30 → 50 → 70 → 80(critique) | Taste |
| `product-polish` 已有产品打磨 | 打磨 / polish / 优化；或后台信号但无新建信号；或视觉页 + 打磨 | 00(compressed) → 40 → 50 → 70 → 80 | Impeccable polish / distill / harden |
| `operate-build` 后台新建或重做 | 后台类信号 **且** 新建 / 重做 / 从零 / 重新设计 | 00(archetype) → 40(规划 L1–L6) → 30 → 50 → 70 → 80 | playbook spec L1–L6 + Impeccable operate |
| `system-unify` 设计系统统一 | 统一 / 不一致 / token / normalize | 00(scope) → 60 → 30 → 50 → 80 | Impeccable normalize / extract |
| `screenshot-restore` 截图还原 | 截图 / 还原 / figma / 照着 | 00(reverse) → 10 → 30 → 50 → 70 → 80(compare) | Taste 的「看你做出来的东西」 |
| `pre-launch` 上线前审查 | 上线前 / 能不能上线 / audit / 验收 | 00(reuse) → 80(audit) → 回流 ≤3 → 80 确认 | Impeccable audit + playbook 回流索引 |

互相区分的关键：operate-build 和 product-polish 看有没有新建信号（打磨已有后台不跑 30，不重审架构）；launch-visual 和 product-polish 看是不是 0→1（打磨不重定方向）；system-unify 跨页、product-polish 单页；pre-launch 只记录、不修。

## 8. 审美与体验细节放在哪一层

- **审美**：`references/aesthetics.md`（A-01 方向卡 · A-02 字阶「少而远」· A-03 配色比例 · A-04 带日期的反 AI 味禁用清单 · A-05 构图与留白 · A-06 签名动效 · A-07 Taste 规则在 Lobe 下的改写 · A-08 密度取数表 · A-09 LobeUI 兼容速查）。20 读全部 A，50 读 A-02..A-05（控制台只读 A-04、A-05）。能计数的部分进 lint（第 10 节）。
- **体验细节**：`references/detail-checklist.md` 七维 X-1..X-7，每项标注检出方式：S（check-detail 脚本）/ L（lint）/ B（浏览器）/ R（人工阅读）。70 是唯一加载它的 stage。

## 9. 自进化机制

```
   用户纠正 / 80 发现复发问题 / 60 或 lint 扫描发现漂移 ≥2 处
                         │
                         ▼
   ① 记录：node scripts/check-learnings.mjs --new → LOG.md 追加 ```learning 块
      （symptom / source / scenario / stage / occurrences / root_cause …）
                         │
                         ▼
   ② 选层（由强到弱，选当前可行的最强一层）：
      structure（pipeline.json 白名单、输出模板、check-structure）
        > lint（lint-lobe / check-detail）
          > rule（references 编号规则）
            > style（只能人审，必须写 why_not_code）
                         │
                         ▼
   ③ 落地：先写失败 fixture（expect:）→ 写反例 good fixture → 加规则（默认 WARN，带 since）
      → 在 reference 旁标注 lint id → bump 版本 + CHANGELOG 点名
                         │
                         ▼
   ④ 闸门：node tests/run.mjs  ← check-learnings 校验 L-01..L-06、V-01..V-03
                         │
                         ▼
   ⑤ 记账：LOG 条目 status: landed / version / regression
```

**硬约束（违反即 FAIL）**：

- L-01 同一现象第二次出现必须升一级（「同一个错犯两次，就写下来」→ 这里更进一步：第二次不能还停在 style 层）。
- L-02 lint 层落地必须有真实规则 id 和带 `expect:` 的回归 fixture。
- L-03 rule 层落地的编号必须在 references 中有定义。
- L-04 landed 必须带版本，且 CHANGELOG 有该版本。
- L-05 style 层必须写 `why_not_code`。
- L-06 豁免必须写理由，没有理由的 `lobe-design-ignore` 不生效并报 FAIL。
- V-01 SKILL.md / pipeline.json / CHANGELOG 版本一致；V-02 每条规则都有回归样例；V-03 每条规则的 `since` 在 CHANGELOG 中登记。

**版本化**：patch 修误报、补用例（本次 2.1.1）；minor 加规则或 WARN 升 FAIL；major 改 stage 或路由映射。新规则先 WARN，连续两个版本无误报再升 FAIL。删除的规则不复用编号。

**真实运行记录**：LOG.md 中已有 8 条，其中 LRN-01（视觉 stage 被架构占用 → structure 层）、LRN-02（悬空 K-16 → check-structure）、LRN-07（在 lobehub/src/features 真实代码上跑出误报 → 排除规则 + good fixture）都已落地；LRN-06（方向卡像任何一家公司）留在 style 层，并写明了复发时升级为结构化模板的路径。

## 10. 规则脚本化：哪些写进了代码

对照《写进提示，不如写进代码》的四层：「代码结构 > lint > 规则 / Skill > 风格指南」。

| 层 | 本 skill 的落点 | 例子 |
| --- | --- | --- |
| 结构 | `pipeline.json` 白名单 + `check-structure.mjs`（57 项） | 50 引用 `C-*` → FAIL；stage 缺「不负责」节 → FAIL；场景 pipeline 不从 00 开始 → FAIL；出现第二个 SKILL.md → FAIL |
| 结构 | `route.mjs` | 宏观、中等、精细由代码判定，不靠模型临场理解 |
| lint | `lint-lobe.mjs` 39 条（FAIL / WARN，每条带 ref、stage、since） | 架构：`LOBE-ANTD-IMPORT`、`LOBE-CREATE-STYLES`；审美：`LOBE-PURPLE-GRADIENT`、`LOBE-EYEBROW`、`LOBE-FONT-SIZE-SCALE`、`LOBE-SPACING-OFFGRID`、`LOBE-GRADIENT-ANIMATION-OVERUSE`；a11y：`LOBE-OUTLINE-NONE`、`LOBE-ICON-BUTTON-LABEL`；文案：`LOBE-VAGUE-ERROR`、`LOBE-MULTI-PRIMARY` |
| lint | `check-detail.mjs` 9 条 | 有请求却没有 loading / error / empty / retry；有提交却无 pending / 结果反馈；危险操作无确认；禁用无原因；输入无 label |
| 闸门 | `check-learnings.mjs` + `tests/run.mjs` | 回写约束、规则 ↔ 回归 ↔ 版本；fixture 的「无意外命中」防止误报；变异测试（放宽阈值后回归必须变红，见 `.verify-t5.sh`） |
| 规则 | references 编号规则 | 「一屏一个焦点」「区块间距 ≥ 内部 2 倍」：需要看截图，判据写成数值 |
| 风格 | aesthetics / detail-checklist 的 B / R 项 | 方向是否只属于这个主体 |

和 playbook 的对应：playbook 把声明（spec / domain / craft / design / components / template）和执行契约（skill / evaluator）分开。本 skill 中，references 是声明，SKILL.md + stages 是调度契约，80 + evaluator 是验收契约；playbook 的「回流索引」变成 80 的回流表，并且被映射到 stage 编号，而不是文档名。

## 11. 与参考技能的对照

### 11.1 Taste Skill（0→1 视觉）

| Taste 的做法 | 本 skill 的吸收方式 | 没有照抄的部分及原因 |
| --- | --- | --- |
| 「点子来自主体」：先列 8–12 条只属于这个客户的事实 | 00 的 `subject` 模式（主体事实 ≥ 8，竞品替换测试 ≥ 3 条通过，每个 section = 主张 + 证据） | — |
| `draw.mjs` 从 20 种方向里发 3 张，Agent 选一张 | 20 要求写 2 个**彼此不同**的方向候选并各自追溯到主体事实，再做竞品替换测试 | 不引入 247 站点的方向库和随机发牌脚本：Lobe 的字体、主色、品牌渐变由主题决定，方向库里大部分字体和配色在 Lobe 下不可用 |
| 带日期的反 AI 味清单（eyebrow、居中大标题 + 双按钮、三等大卡片、渐变文字…） | A-04（2026-10 版），其中 6 条进了 lint | — |
| 「无装饰的房子风格」+ `inspect.mjs` 浏览器测量 | 能静态判断的做成 lint（字阶、间距网格、字距、动画属性） | 不依赖 Chrome / Node 22；浏览器测量留作后续（第 15 节） |
| 禁止一切渐变、阴影、1px 边框、玻璃、monospace；至少 4 张真实图、8 个动效元素 | A-07 逐条改写为 Lobe 版：允许 `gradientAnimation` ≤ 2 处、阴影按档位、`colorBorderSecondary` 1px、blur 只给浮层、代码用 `fontFamilyCode` | 图片和动效数量下限不采用：控制台不需要；视觉页的数量由论证决定 |
| 三个宽度截图 + 评审 rubric + 修改 + 再看 | 80 的 `critique` 模式（一秒印象、眯眼、遮 Logo…），要求明暗 + 390px 截图，拿不到就标「证据缺失」 | — |
| Taste 明确声明不适用于后台、表格、多步产品 UI | 后台场景完全不跑 20；A-08 按页面类型给不同密度 | — |

### 11.2 Impeccable（打磨上线）

| Impeccable 的做法 | 本 skill 的吸收方式 | 没有照抄的部分及原因 |
| --- | --- | --- |
| 24 个命令（audit / critique / polish / distill / clarify / harden / adapt / normalize / extract / typeset / colorize / animate / quieter / bolder …） | 收敛为 stage 内的焦点清单：audit→80，critique→80，polish 的分诊→60，distill / clarify→40，normalize / extract→60，harden / adapt→70，typeset / colorize / animate / quieter→50 | **不做成独立命令**：24 个入口就是用户试过的「过细」方案，宏观指令会失灵 |
| Modes：Persuade / Operate / Read，按 surface 而不是按产品选择 | 页面类型 + 场景：launch-visual ≈ Persuade，operate-build / product-polish ≈ Operate；A-08 按页面类型给密度 | 不单独设 Read 模式：Lobe 文档站由 `Layout` 骨架覆盖，不需要第三套审美 |
| `PRODUCT.md` / `DESIGN.md` 项目上下文 | 00 优先读项目层 `.agents/ux/product.md`；design 真相源是 Lobe 主题和 design.md | 不生成项目级 DESIGN.md：token 已经在 `cssVar` 中，再写一份会漂移 |
| polish 的四分类（缺 token / 一次性实现 / 概念不一致 / 局部缺陷） | 60 的漂移分诊表，每条都派发到 30 / 50 | — |
| audit 的五项技术体检打 0–4 分 | 80 的技术体检（a11y / 性能 / 主题 / 响应式 / 完整性） | — |
| `impeccable detect` 规则引擎 + signals 驱动的上下文菜单 | `lint-lobe.mjs` / `check-detail.mjs`；模糊指令时给 2–3 条路径（`ambiguousSuggestions`） | 规则全部针对 LobeUI 写法重写，不移植其 HTML / CSS 通用规则；不做 live 浏览器覆盖层 |
| 多个 agent（finish-reviewer 等） | 80 的生成 / 评估隔离（只记录不修） | 不拆子 agent，保持单 skill |

### 11.3 两者都没有引入

`temp/` 只作为参考材料（已于 3.0.1 清理，见第 14 节），不在 skill 目录内；`check-structure.mjs` 的 `single-entry` 会忽略 `temp/`、`.backup/`、`vendor/`，但如果 skill 目录下出现第二个 SKILL.md，就会 FAIL。

## 12. 路由演练

以下路由结果都是 `node scripts/route.mjs "<指令>"` 的真实输出（2.1.1），并已写进 `tests/route-cases.json`。各 stage 的输入、输出按 stage 文件的「输入」「输出」节推演。

### 12.1 宏观指令：「把 lobehub-admin-enterprise 的成员管理后台从零重做一遍」

**路由器输出（摘录）**

```
场景：operate-build（后台 / 看板 / 表单 / 工作流（新建或重做））　颗粒度：macro
Pipeline：00-brief → 40-flow → 30-structure → 50-visual → 70-detail → 80-review
依据：
  - 场景信号：后台→operate-build，admin→operate-build（含新建信号）
  - 宏观 → 场景「后台 / 看板 / 表单 / 工作流（新建或重做）」的默认 pipeline
```

**为什么这样判**：「后台」「admin」是后台信号，「从零」「重做」是新建信号 → operate-build（而不是 product-polish）。「从零」「重做」也是宏观信号 → 宏观。没有命中任何关注点，所以不存在「只跑某几个 stage」的可能。

**逐 stage 推演**

| # | Stage | 输入 | 产出（交给下游） | 本 stage 不碰的 |
| --- | --- | --- | --- | --- |
| 1 | 00 brief（archetype） | 指令；`.agents/ux/product.md` 的成员管理节；路由 / 权限点 / tRPC mutation；P-02 列表 / 搜索 / 筛选 + P-03 详情 / 对象页原型 | 角色：企业管理员，来意「处置 / 配置」，每周；主任务「把对的人放到对的角色上，并清掉离职账号」；关键决定「这个人该不该有这个权限」；决定所需信息 1. 角色 2. 最近活跃 3. 所属团队 4. 邀请状态；危险：移除成员（不可撤回，波及其会话和 API Key，二次确认）、批量改角色；密度：高 | 组件、颜色 |
| 2 | 40 flow（规划） | brief 的主任务、关键决定、危险操作、来路去路；P-02 第一屏优先级 | L1–L6：L2 区域 = 筛选栏 → 成员表（列顺序 = 决定所需信息）→ 详情抽屉；L3 主链路「筛选 → 选中 → 改角色 → 结果反馈」，分支「批量」「邀请」；**L5 状态清单**：首次空 / 筛选空 / 加载 / 失败 / 无权限 / 批量部分失败；L6 Given/When/Then；按钮文案「移除成员」而不是「确定」（W-01） | 不写组件名 |
| 3 | 30 structure | brief 原型 P-02 / P-03；40 的 L2 区域；硬性前提 | `ConsoleShell` + `PageHeader` + `Surface`；表格从 `@lobehub/ui/base-ui` 导入，表单从 `/base-ui/form` 导入；角色用 `Tag`（分类），状态用 `Badge`（状态），按 C-03 区分；列头说明用 `TitleWithTips`（C-09）；lint RESULT 无 FAIL | 间距、颜色 → 50 |
| 4 | 50 visual | brief 的密度「高」、决定所需信息；30 的骨架 | 表格行 40–48px、区块间距 16–24（A-08 控制台行）；角色列视觉权重最高；危险动作色从 `colorError` 派生（D-03）；lint 无 `LOBE-RAW-COLOR`；遗留：无 | 组件替换（看到就记 → 30） |
| 5 | 70 detail | brief 的危险操作和对象生命周期；40 的 L5 | 七维覆盖表；补齐 L5 的 6 种状态；批量部分失败「只重试失败项」（X-1.6）；移除确认写明后果（X-3.3 / W-06）；`check-detail` RESULT 无 FAIL；390px 下表格横向滚动策略 | 层级顺序 → 40 |
| 6 | 80 review（audit） | brief 主任务 / 关键决定；各 stage 交接；截图 | 技术体检 5 项 0–4 分；六维评分；阻断项对照「主任务不明」「主路径断裂」；有问题时最多 3 条回流（例如「批量角色修改无结果反馈 → 70」），确认一轮 | 不改代码 |

**体现的设计**：业务第一（00 的「决定所需信息」直接决定 40 的区域顺序、30 的列顺序、50 的视觉权重）；40 在 30 之前（先定功能再选零件）；50 不看组件文档。

### 12.2 宏观指令（边界）：「整体打磨一下官网落地页」

```
场景：product-polish（已有产品迭代打磨）　颗粒度：macro
Pipeline：00-brief → 40-flow → 50-visual → 70-detail → 80-review
依据：
  - 视觉页 + 打磨信号且无新建信号 → 降为 product-polish（沿用现有方向）
```

已有官网只是打磨，不应重定方向（不跑 20），也不应重审架构（不跑 30）。如果改成「重做官网落地页，现在太像模板了」，则含有新建信号 → launch-visual，跑 `00(subject) → 20 → 30 → 50 → 70 → 80(critique)`。两条都在回归用例里。

### 12.3 中等指令：「订阅计费页的信息层级有点乱，空态和报错也没处理」

**路由器输出（摘录）**

```
场景：product-polish（已有产品迭代打磨）　颗粒度：medium
Pipeline：00-brief → 40-flow → 70-detail
依据：
  - 关注点命中：层级→40-flow，空态→70-detail，报错→70-detail
  - 场景信号：计费→operate-build
  - 中等 → 只跑 2 个被点名的 stage，按 stageOrder 排序
```

**为什么这样判**：「计费」是后台信号但没有新建信号 → product-polish；命中了 2 个 stage 的关注点（40、70），没有宏观信号 → 中等。**不跑 50**：用户没提视觉；**不跑 30**：打磨不重审架构；**不跑 80**：中等指令以各 stage 的自查结束。

| # | Stage | 输入 | 产出 |
| --- | --- | --- | --- |
| 1 | 00 lite | 指令 + 当前页面 | 一行：`控制台 · 确认当前套餐与本期账单并决定是否升级 · 中` |
| 2 | 40 flow（打磨） | lite brief 的主任务；现有页面 | 第一屏改为「当前套餐 + 本期用量 / 额度 + 升级入口」，账单历史降到下方；删掉重复的套餐说明（W-07）；「升级」成为唯一主动作（W-01）；**交给 70 的状态清单**：无订阅空态、账单加载失败、支付失败 |
| 3 | 70 detail | lite brief；40 交来的状态清单；代码 | 无订阅空态给出「选择套餐」第一步动作（W-04）；账单失败写明原因并提供重试（W-05 / X-1.2）；刷新失败保留已有数据（X-1.4）；`lint` + `check-detail` RESULT 行；七维表中不涉及的维度标 n/a |

**体现的设计**：顺序由 stageOrder 决定（先定层级再补状态，40 的 L5 状态清单正好是 70 的输入），而不是由用户的语序决定；即使只有一行，40 也要依据 lite brief 的主任务来排第一屏。

另一条中等指令「把 antd 的 Table 换成 base-ui，顺便把间距对齐」→ `00 → 30 → 50`：架构问题只在 30 处理，50 处理间距时不会再读 components.md。

### 12.4 精细指令：「删除 API Key 的确认弹窗按钮写的是确定，改一下文案」

**路由器输出（摘录）**

```
场景：未识别　颗粒度：fine
Pipeline：00-brief → 40-flow → @selfcheck
  3. @selfcheck —— 跑 lint-lobe.mjs + 本 stage 检查清单做范围内自查（不做完整 80 评分）
按需加载（进入该 stage 时才读）：
  00-brief: stages/00-brief.md + references/admin-archetypes.md
  40-flow: stages/40-flow.md + references/admin-archetypes.md, references/copy.md
依据：
  - 关注点命中：文案→40-flow
  - 精细 → 直达单个 stage
```

| # | 步骤 | 输入 | 产出 |
| --- | --- | --- | --- |
| 1 | 00 lite | 指令 | `控制台 · 管理 API Key · 中`；从「删除」推出危险操作：不可撤回，使用该 Key 的调用会立即失败 |
| 2 | 40 flow | lite brief 的危险操作；copy.md 的 W-01 | 按钮「确定」→「删除 API Key」（动词 + 对象）；确认强度和不可撤回性匹配 |
| 3 | @selfcheck | 改动文件 | `lint-lobe.mjs <文件>`：`LOBE-VAGUE-BUTTON` 不再命中；40 清单第 2、4 条通过 |

**为什么直达单个 stage**：只有一个关注点（文案 → 40），没有场景信号、宏观信号和锚点。只加载 2 个 reference，不读 components / design / aesthetics。这个 stage 的边界里有一处值得说明：**确认弹窗的说明文字**（写清后果）属于 W-06，归 70。如果用户只要求改按钮，40 会把「说明文字也需要写清后果」记成 `遗留 → 70`，而不会顺手展开 70 的七维检查。精细指令仍然先过 00 lite：正是 lite brief 里的「不可撤回」，决定了按钮应该写成危险动作的动词。

### 12.5 精细指令：「这个页面的 LOBE-RAW-COLOR 报错怎么修」

```
颗粒度：fine
Pipeline：00-brief → 50-visual → @selfcheck
依据：
  - 点名规则 LOBE-RAW-COLOR → 50-visual
  - 关注点命中（已被点名规则覆盖，仅记录）：报错→70-detail
```

点名的 lint id 说了算：`LOBE-RAW-COLOR` 在 `lint-lobe.mjs` 中登记为 `stage: '50-visual'`，所以直达 50，按 D-02 的视觉角色把裸 hex 映射到 token（找不到就按 D-11 写缺口）。「报错」这个词在这里是在描述 lint 输出，不是在说错误态；2.1.0 会把它路由到 70，这是本次修正的不一致之一。

其余精细用例（都在回归用例中）：「修一下 K-07 的问题」→ 70；「修一下 X-3.6」→ 70；「图表颜色违反了 E-02」→ 50；「LOBE-ANTD-IMPORT 怎么改」→ 30；「这里用哪个组件比较好」→ 30；「按钮在暗色下看不清」→ 50。

### 12.6 模糊指令：「看看这个」

无场景、无关注点 → 不执行，给出 3 条路径（整体打磨 / 上线前体检 / 只看视觉），让用户选择。这样避免猜错后跑完一整条 pipeline。

## 13. 本次（2.1.1）修正的不一致

撰写本文档时，逐条对照 SKILL.md、stage 文件和 `route.mjs` 的实际行为，发现并修复了以下问题（每条都已加回归用例）：

| # | 不一致 | 修复前 | 修复后 | 位置 |
| --- | --- | --- | --- | --- |
| 1 | lint 报告的 stage 与路由不一致 | 「这个页面的 LOBE-RAW-COLOR 报错怎么修」→ 70（被「报错」带走） | → 50（lint 规则自己的 stage）；点名编号时关键词只记录 | `route.mjs` `checkOwner` |
| 2 | X 清单编号不可路由 | 「修一下 X-3.6」→ ambiguous | → 70 | `pipeline.json ruleOwners.X`；`route.mjs` 正则 |
| 3 | SKILL.md 说「打磨沿用现有视觉，不跑 20」，路由器却让已有官网打磨跑 20 + 30 | 「整体打磨一下官网落地页」→ launch-visual | → product-polish | `route.mjs` `polishOnlyVisual` |
| 4 | 「从业务出发重新设计」不算新建 | → product-polish（不跑 30） | → operate-build | `pipeline.json buildSignals / macroSignals` |
| 5 | SKILL.md 规则编号说明漏了 X 和 LOBE / DETAIL | 只列 C/D/K/E/P/A/W | 补全，并写明「点名编号时以编号为准」 | `SKILL.md` 颗粒度一节 |
| 6 | 根目录 README 停留在 2.0（没有 check-learnings、learnings 闸门） | — | 已更新 | `README.md` |

版本：2.1.0 → **2.1.1**（patch：没有改变任何 lint / detail 规则的通过条件；场景映射本身未变，只修正了与 SKILL.md 描述不一致的实现）。V-01 已确认 SKILL.md、pipeline.json、CHANGELOG 三处一致。

## 14. 最终文件结构与命令

> 本节描述 3.0.1 的结构。1.x → 2.x 的重构过程见第 1–13 节。

```
lobe-design-skill/                                      仓库根
├─ README.md                                             面向使用者：安装 + 各场景 prompt 模板
├─ install.sh                                            安装（软链 / 拷贝 / 卸载）
├─ AGENTS.md                                             本仓库的规矩；托管块由自身 bootstrap 生成
├─ LICENSE · .gitignore · .claude-plugin/ · .github/workflows/ci.yml
└─ skills/lobe-design/                                  skill 本体（自包含，可整目录拷贝）
   ├─ SKILL.md                 唯一入口（frontmatter: name / version 3.0.1 / description）
   ├─ stages/                  10 个 stage（含 05-init）
   ├─ references/              components(C) design(D) craft(K) ecosystem(E) admin-archetypes(P)
   │                           aesthetics(A) copy(W) detail-checklist(X) models(M) init(I) evaluator
   │                           每份顶部有 refs:meta（tier / scope / entries），供渐进式披露解析
   ├─ scripts/                 pipeline.json · route · refs · intent · bootstrap · upstream
   │                           lint-lobe · check-detail · check-structure · check-learnings
   ├─ tests/                   run.mjs · route-cases.json · fixtures/
   ├─ learnings/               README.md（回写流程 + 版本化）· LOG.md
   ├─ docs/REFACTOR_NOTES.md   本文件（执行时不加载）
   └─ CHANGELOG.md
```

**为什么 skill 放在 `skills/lobe-design/` 而不是仓库根**：与 skills 仓库的通行布局一致
（Taste / Impeccable 都是顶层 `skills/<name>/`），安装时可以整目录拷贝或软链，
也便于将来在本仓库放第二个 skill。skill 目录**保持自包含**是有意的：
`check-learnings.mjs` 读同目录的 `CHANGELOG.md`，`refs.mjs` 读同目录的 `references/`。

**`check-structure.mjs` 的 `repoRoot` 从这里向上找 `.git`**，不假设 `skillDir/..` 就是仓库根 ——
否则迁移后「单入口」检查只会扫到 `skills/`，覆盖范围悄悄变小。

3.0.1 清理掉的东西：`temp/`（第三方参考 clone，786MB）、`.backup/`（已被 git tag
`backup/pre-pipeline-refactor-20261014-141721` 完整覆盖，manifest 逐字核对通过）、
以及 12 个 `.verify-*.sh|.out.txt` 临时脚本（其验收已折进 `tests/run.mjs`）。

常用命令（在 `skills/lobe-design/` 下运行，Node ≥ 18，零依赖）：

```bash
node scripts/route.mjs "<指令>" [--json] [--has-brief]   # 路由：场景 / 颗粒度 / stage 序列
node scripts/refs.mjs "<指令>" [--stage 50-visual]        # 渐进式披露：该读哪些条目
node scripts/refs.mjs --audit                            # 审计 tier 划分与 always 预算
node scripts/intent.mjs "<原话>"                          # 抽象指令 → 可执行表述
node scripts/bootstrap.mjs [--root <dir>]                # 项目接入（--check / --print）
node scripts/upstream.mjs [--write <file>]               # 消费方回流候选
node scripts/lint-lobe.mjs <路径> [--stage 50-visual]     # 静态检查
node scripts/lint-lobe.mjs --rules                       # 40 条规则 + ref + stage + since
node scripts/check-detail.mjs <路径>                     # 状态 / 反馈覆盖
node scripts/check-structure.mjs                         # 单入口、契约、隔离、refs:meta、模型词
node scripts/check-learnings.mjs [--new]                 # 自进化闸门 / 生成新条目模板
node tests/run.mjs                                       # 全部回归（181 项）
```

## 15. 已知局限与后续方向

- 路由基于关键词，没有语义理解。同义词需要补进 `pipeline.json`，并且每次都要配一条 route-case。可以用 LOG 条目（`stage: router`）追踪漏判。
- B 类检查（对比度、溢出、触控尺寸）仍依赖人工截图；后续可以按 Taste `inspect.mjs` 的思路增加一个可选的浏览器测量脚本，但不能把它变成必需依赖。
- `check-detail` 是启发式（做了 X 必须有 Y），存在漏报；误报通过 good fixture 锁住，漏报依靠 80 的人工审查兜底。
- LRN-06（方向卡空泛）仍在 style 层；如果复发，按 L-01 必须升级为结构化方向卡字段（structure 层）。

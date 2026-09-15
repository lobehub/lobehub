# Worked example — Constraint Solver 方案卡（chat 内 builtin tool Render / Inspector）surface audit

审计对象是 `builtin-solver` builtin tool 在聊天里的呈现，包括 Inspector 一行摘要、solve 结果卡（可行 / 限时 / 不可行 / 规格错误）和 verify 校验卡。日期 2026-09-16。

**前提（用户拍板，是约束，不在评审范围内）：卡片就是方案本身，不是证据。** 求解得到的行程方案是这次对话交付给用户的产物，卡片必须完整承载它；模型的文字回答负责解释取舍和理由，不再复述行程。本审计的第一版以「证据还是方案」二选一来评估，已按这个前提整体重做。

**Layers run:**

- L1 (static / code) ✅：`packages/builtin-tool-solver/src/client/**`、`src/types.ts`、`src/systemRole.ts`、`packages/locales/src/default/plugin.ts:460-492`，以及一份真实方案数据 `.records/solver-e2e-acceptance/runs/validation_1.jsonl`。
- L2 (visual) ✅，只覆盖部分状态：验收 ab8a252e 的 5 张真实聊天截图，暗色，1280×577 桌面宽。已覆盖最优解、不可行、verify 全通过；没截到 `feasible_timeout`、规格错误、多个候选方案、亮色、窄屏。
- L3 (dynamic) ⏳ 未跑。

Surface = 一次求解在聊天里留下的全部内容，从上到下是：solve 的 Inspector 行和方案卡，模型的深度思考块，verify 的 Inspector 行和校验卡，最后是模型的文字回答（截图 `000da0`、`7bc4e5`、`4c5d4b`）。

## 0 — Surface class：「对话里交付的方案产物」通常具备什么

参照的同类产品：

- **Claude Artifacts / ChatGPT Canvas**：产物在对话里是一张卡，可以点开到侧边完整查看，模型的正文只做讲解。
- **Google Travel、Wanderlog、TripIt 的行程页**：
  - 顶部是这趟行程的概况：去哪、几号到几号、几个人、预算。
  - 主体是逐日时间线，每一项都标出时间、地点和费用。
- **Kayak / Google Flights**：几个方案可以切换，并标出「最佳 / 最便宜 / 最快」。
- **Airbnb / Booking 的订单摘要**：把用户提的条件原样列回去，方便用户核对。

据此列出方案卡应具备的能力，逐条对照：

| 期望能力                                                                             | 现状                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 完整行程是卡片主体：逐日展示交通详情、三餐、景点、住宿                               | — 基本缺失。三餐和景点完全不渲染，逐日行程默认收起，交通详情只剩一个出行方式（gap ①） |
| 顶部是行程概况：路线、日期、人数、预算，硬性要求和偏好分开列（同时用来核对需求理解） | — 缺失。只有一组从 spec 推出来的「满足的约束」子集（gap ②）                           |
| 模型正文只讲取舍，不复述行程                                                         | — 缺失。提示词要求模型 present，正文把整份行程又写了一遍（gap ③）                     |
| 无解时说明「这份方案做不出来」，并给出可以直接选的放宽选项                           | — 缺失。放宽建议是纯文本，模型自己选定后再告知（gap ④）                               |
| 方案上可以直接调整：改某个条件后重算、选这个方案、打开完整视图                       | — 缺失。卡片上没有任何动作，也没有 Portal（gap ⑤）                                    |
| 总价、预算对比和费用分项                                                             | ✅ 已有（§2）                                                                         |
| 保证强度写在方案上：最优 / 限时 / 已校验                                             | ⚠️ 最优和限时的区分做得好；「已校验」是另一张独立卡片（gap ⑧）                        |
| 几个备选方案可以切换，并标出取舍差异                                                 | — 缺失。候选方案竖着排，彼此只差价格（gap ⑦）                                         |
| 用人能读懂、已本地化的文案                                                           | — 缺失。JSON 路径、snake\_case 键名、pack id、服务端英文原文都露给了用户（gap ⑥）     |

## 1 — Patterns in use

| Pattern (family)                   | Where                                                                                               | Rating | Note                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Loading Indicator (feedback)       | `Inspector/Solve.tsx:26-34,41`：参数流式输出和执行期间都显示 `shinyText`                            | ✅     | 进行中有反馈                                                                                     |
| Status honesty (feedback)          | `Render/Solve/index.tsx:36-43` 的 info Alert，加上 `CandidateList.tsx:121-123` 的 time-limited 徽章 | ✅     | **亮点**，见 §2                                                                                  |
| Card (layout)                      | `CandidateList.tsx:106-201`                                                                         | ⚠️     | 作为方案产物，卡片只装了摘要；没有 `Block` 容器，12px 灰字直接铺在聊天背景上（L2 `000da0`）      |
| Accordion / Collapsible (layout)   | `CandidateList.tsx:69,175-199` 的逐日行程                                                           | ⚠️     | 方案主体被收进一个默认关闭的开关，而且开关是手写的，无法用键盘操作（gap ①⑨）                     |
| Overview + Detail (data)           | 卡片 → 完整视图                                                                                     | —      | 缺失。Portal 注册表已有（`packages/builtin-tools/src/portals.ts`），DocumentCard 有先例（gap ⑤） |
| Titled Sections (layout)           | `CandidateList.tsx:127-173`                                                                         | ⚠️     | 概况、行程、花费、约束没有分区，全用「标签 + 冒号」拼成一行一行的文字                            |
| Button Groups / Preview (commands) | 无解时的放宽选项、方案上的调整操作                                                                  | —      | 缺失（gap ④⑤）                                                                                   |
| Grid of Equals / tabs (data)       | 多个候选方案                                                                                        | —      | 缺失（gap ⑦）                                                                                    |

## 2 — Strengths / good cases（don't regress）

- **✅ 亮点：限时结果不冒充最优解。**
  - `feasible_timeout` 的卡片上有 info Alert，写明「在时间限制内找到的最佳方案，未证明全局最优」（`Render/Solve/index.tsx:36-43`）。
  - 每个候选方案另带一个 time-limited 徽章（`CandidateList.tsx:121-123`），Inspector 里也是单独一档状态（`Inspector/Solve.tsx:14-19`）。
  - 方案产物把求解器能给出的保证强度原样交给用户。重设计时应把它放进方案概况，作为一个信任标记。已回灌为 ux Read §1.14 的 ✅。
- **✅ 亮点：Inspector 一行就能看懂结果。** 完成后显示「状态 + 关键数字」，例如「最优解 ($306)」「不可行 (1 个冲突)」「通过 (13/13)」（`Inspector/Solve.tsx:50-67`、`Inspector/Verify.tsx:37-50`，L2 `000da0`、`1ee126`、`7bc4e5`）。卡片改成方案产物之后，这一行仍然是它的标题行，不要删。
- **✅ 总价、预算对比和费用分项放在一起。**「$306 / $1,400 预算内」加「餐饮 $54・住宿 $116・交通 $136」（`CandidateList.tsx:110-120,147-160`，L2 `000da0`），看一眼就知道钱花在哪、有没有超预算。这正是行程产物该有的费用区，保留下来。
- **✅ 无解是正常结果，不是报错。** `infeasible` 用 warning 样式并带结构化冲突（`Render/Solve/index.tsx:52-58`），和 `error` 分支分开处理。

## 3 — Experience gaps（ranked）

### ① 🔴 卡片装不下方案：三餐和景点完全不渲染，逐日行程默认收起，交通详情只剩出行方式。违反「卡片即方案」前提和 Read §1.14

- **证据 L1：真实方案数据。** `validation_1` 第 2 天的内容：
  - 早餐 Mood 4 Food，午餐 Uraki，晚餐 Pizza Street
  - 景点 Pima Air & Space Museum
  - 第 1 天交通「self-driving, from Oakland to Tucson, duration: 12 hours 40 mins, distance: 1,372 km, cost: 68」
- **证据 L1：卡片的渲染逻辑。**
  - 逐日行程只输出城市、交通、住宿，`breakfast`、`lunch`、`dinner`、`attraction` 一个都没有用到（`CandidateList.tsx:186-196`）。
  - 逐日行程默认折叠（`useState(false)`，`:69`）。
  - 交通被正则压成 `flight` / `self-driving` / `taxi`，时长、距离、费用全部丢掉（`:37-48,83-92`）。
- **证据 L2**：`000da0` 里卡片只有路线、交通方式、住宿、费用分项和一个「▸ 逐日行程」开关。紧接着，模型在正文里写出了完整的「3-Day Tucson Itinerary」。
- **为什么是 🔴**：
  - 按前提，这张卡就是交付物；可它丢掉了一半以上的方案内容，用户要做决定时需要的「每天去哪吃、看什么、路上开多久」都不在卡上。
  - 结果真正的方案只能由模型在正文里重写，求解器保证的结构化结果退化成了 LLM 复述，而复述本身就可能出错。
- **修复**：
  - 卡片主体换成默认展开的逐日时间线：每天的交通段写明方式、时长、距离、费用，三餐和景点逐项列出，住宿单独一行。
  - 在聊天流里过长时，卡片显示概况和前 1–2 天，点「查看完整方案」在 Portal 打开整份行程（参考 `packages/builtin-tools/src/portals.ts` 的注册表和 `DocumentCard.tsx:64-76` 打开文档的写法）。

### ② 🔴 没有行程概况：用户看不到模型理解的需求，「满足的约束」只是 spec 子集，却以已满足的口吻展示。违反 Read §1.12 和 Certainty

- **证据 L1**：`CandidateList.tsx:97-104` 只取了 budget、cuisines、roomType、houseRule、transportation 五项，出发地、日期、人数、城市数、偏好都不展示。
- **证据 L2**：`000da0` 这条请求有路线、日期和人数，卡片上只显示了 `budget ≤ $1,400`。
- **为什么是 🔴**：formulation 实验里 5/30 的失败全是需求抽取错误，例如必吃菜系被写成了偏好、房型条件丢了。抽错时求解器照样给出最优解，verify 照样 13/13 通过，卡片还给抽错的条件贴上「满足」的标签。
- **修复**：方案顶部放一个行程概况区（订单摘要式）：

  - 基本信息：出发地 → 目的地、几号到几号、几个人、预算。
  - 条件：「必须满足」和「尽量满足」分两组列出。
  - 每一项都可以点击改写，改完直接重新求解。

  这个概况区同时承担两件事：方案本身的抬头，以及让用户核对模型有没有理解对。「满足」这个说法只用在经过独立校验的条目上。

### ③ 🟠 模型在正文里把方案重新写了一遍，因为提示词就是这么要求的。违反「卡片即方案」前提和 Read §1.14

- **证据 L1**：`systemRole.ts:53` 写的是「formalize → self-check → solve → verify → present (with cost vs budget and which constraints were honored)」；`:48-49` 在各个状态下都要求「Verify, then present」。
- **证据 L2**：`4c5d4b` 里正文有完整的「Constraints honored ✅」清单和逐日行程，排版比卡片还完整。
- **修复**：提示词改成「方案卡已经向用户展示了完整行程。回答只写三件事：为什么选这个方案、放宽了什么或还有哪些取舍、建议的下一步。不要复述行程和费用明细。」配合 gap ①，先让卡片装得下方案，再撤掉正文复述；顺序反过来会让用户什么都看不到。

### ④ 🟠 无解时没有给用户可选的出路：放宽建议是纯文本，模型自己挑一条放宽后才告知用户。违反 Act §3.1

- **证据 L1**：`InfeasibleResult.tsx:41-52` 把建议渲染成「・文本」，没有任何可点的操作。
- **证据 L2**：`1ee126` 里冲突卡下方没有按钮；`4465f0` 里正文写着「预算从 $100 放宽到 $306」。
- **为什么是问题**：预算是用户明确给出的硬性条件，放宽到 3 倍是替用户做了取舍。在「卡片即方案」的前提下，无解状态应当是方案卡的一种形态：「按你的条件做不出来」，下面直接列出可选的出路。
- **修复**：
  - 每条出路做成一个按钮，比如「预算提高到 $306」「少去一个城市」，点击后以用户身份发出选择，或者通过 user-interaction 的询问流程回传给 agent。
  - 提示词：放宽用户的硬性条件之前必须先问，除非用户事先授权过。

### ⑤ 🟠 方案卡上没有任何操作：不能调整条件后重算，不能在多个方案里选定一个，也不能打开完整视图。违反 Act §3.1（forward momentum）和 Overview + Detail

- **证据 L1**：`Render/Solve/**` 里没有任何按钮或回调；本工具没有注册 Portal。
- **为什么是问题**：方案产物的下一步是「改一改」或「就它了」，现在用户只能自己在输入框里打字描述要改什么。
- **修复**：
  - 概况区里的每个条件都可以点击改写（接 gap ②）。
  - 方案上加「选这个方案」和「查看完整方案」（Portal）。
  - 以后如果做导出（日历、分享），也挂在同一个操作区。

### ⑥ 🟠 机器标识和未本地化的服务端英文直接给用户看。违反 Feedback §4.5（已扩展到非错误状态）

- **JSON 路径**：`$.budget`（`InfeasibleResult.tsx:34-38`，L2 `1ee126`）。
- **snake\_case 校验名**：`is_reasonable_visiting_city`（`Render/Verify.tsx:62-64`，L2 `7bc4e5`）。
- **pack id 进了句子**：「已完成 travelplanner 求解」（`Inspector/Solve.tsx:47` + locale `'Solved {{pack}}'`，L2 `1ee126`）。
- **服务端英文原文**：「budget 100.00 is below the minimum feasible plan cost 306.00」（`InfeasibleResult.tsx:40,47`）。
- **前端写死的英文**：`budget ≤`、`room type:`（`CandidateList.tsx:99-104`），以及出行方式 `self-driving`（`:37-48`，L2 `000da0`）。
- **规格错误原样输出**：`pluginState.error` 直接显示（`Render/Solve/index.tsx:63-66`）。
- **修复**：
  - 字段和校验项用 i18n 映射成用户能读懂的名字。
  - 服务端返回 `{ kind, params }`，由前端拼出本地化句子。
  - 规格错误对用户只显示「正在修正需求」，原始明细放进调试入口。

### ⑦ 🟡 多个候选方案只是竖着堆，看不出差异，也没有推荐。违反同类产品惯例

- **证据 L1**：`CandidateList.tsx:212-228` 依次渲染，中间用 divider 隔开；`maxCandidates` 默认是 3。
- **L2 待确认**：本轮截图里都只有 1 个候选方案。
- **修复**：多个候选做成可切换的方案（标签页或分段控件），每个方案标出和其他方案的差异，比如「最便宜」「不自驾」「住宿评分更高」；默认选中推荐的那个。卡片一次只展示一份完整方案，不要三份并排。

### ⑧ 🟡 「已校验」是一张单独的卡，还逐行列出 13 个全部通过的项

- **证据 L2**：`7bc4e5` 里校验卡是独立一块，下面有 13 行 snake\_case。
- **证据 L1**：`Render/Verify.tsx:52-71` 不管通过与否，每一项都渲染一行。
- **修复**：「已独立校验 13/13 ✓」作为信任标记放进方案概况区；只有未通过的项才在卡片里展开说明。verify 自己的 Render 可以精简成「已校验」这一种状态。

### ⑨ 🟡 手写的折叠开关和卡片外壳，而且卡片在聊天工具区里被裁掉一截

- **证据 L1**：`CandidateList.tsx:177-183` 用 `<span role='button'>` 加 ▸/▾ 字符，没有 `tabIndex` 和键盘事件；卡片没用 `Block`，而同类工具（web-browsing、image-generation）都用了。
- **证据 L2**：`000da0` 和 `7bc4e5` 里卡片内容在工具区内部出现滚动条并被截断。
- **修复**：用标准的 `Block` 加折叠组件；长内容交给 Portal（gap ①⑤），不要在聊天流里内嵌滚动。

### ⑩ 🟡 展示层的推导和格式化有隐患

- **路线推导**：`plan.filter((day) => day.days % 2 === 0)`（`CandidateList.tsx:79-81`）假设偶数天就在目的地城市，而真实数据里 `current_city` 在换城日写成「from A to B」这种格式。改用解析 `current_city` 的方式推导，多城市行程要用 L3 验证。
- **币种**：固定写成 `$` 和 `en-US`（`client/utils.ts:1-2`）。
- **限时提示**：直接插入原始毫秒数（`Render/Solve/index.tsx:39-41`），违反 Read §1.5。
- **空结果**：状态是 optimal 但候选方案为空时，卡片一片空白（`Render/Solve/index.tsx:44-48`）。

## 4 — Skill feedback（回灌 ux）

- **Read §1.14（按本次前提修订）**
  - 保留原规则：工具卡只能有一个职责，要么是证据要么是产物，不能两边都讲。
  - 补上「产物」这一支的具体要求：
    - 卡片必须完整承载用户据以行动的每个字段，不能是有损摘要。
    - 默认展开；长内容放进聊天卡片加 Portal 的完整视图。
    - 提示词要说明卡片就是方案，正文只讲取舍。
    - 调整和选定的操作放在产物上。
  - 本次 gap ① ③ ⑤ 作为 ❌。
- **Feedback §4.5（扩展，维持第一版）**：机器标识和未本地化的服务端文案，在所有渲染状态下都不能出现。gap ⑥ 作为 ❌。
- **Act §3.1（扩展，维持第一版）**：agent 放宽用户明确给出的条件之前，先把选项交给用户。gap ④ 作为 ❌。

复现的已有规则：Read §1.10（手写开关、缺少 Block，gap ⑨），Read §1.5（原始毫秒，gap ⑩），Read §1.12（「满足」标签不对所有成员都成立，gap ②）。

## 5 — Layers pending

- **L2**：重设计后重新截图，覆盖 `feasible_timeout`、规格错误、多个候选方案、亮色和窄屏。
- **L3**：
  - 5 天或 7 天的多城市行程，验证时间线和路线推导（gap ①⑩）。
  - 点击放宽选项或改写条件后，agent 能否重新求解，并用新方案替换原来的卡片（gap ②④⑤）。
  - 用键盘展开和收起（gap ⑨）。

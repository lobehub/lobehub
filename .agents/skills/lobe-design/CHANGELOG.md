# CHANGELOG

版本规则见 learnings/README.md §6（patch 修误报 / minor 加规则或 WARN→FAIL / major 改 stage 与路由）。

## 5.4.2 — 2026-10-16

`--copy` 重装时不再把备份留在宿主项目里（patch：不改规则通过条件）。

- **install.sh**：替换已有真实目录时，备份移到 `${XDG_CACHE_HOME:-$HOME/.cache}/lobe-design/backups/<project-basename>-<timestamp>/`，并打印路径；按项目保留最近 5 份，更早的 prune 掉。新增 `--no-backup`。缓存目录不可写时警告并跳过备份，绝不在项目内写 `*.bak.*`。软链安装只删链接，不备份目标树。
- **tests**：`install.sh` 连续 `--copy` 重装断言项目内无 `*.bak.*`、备份在 cache；覆盖 prune、`--no-backup`、不可写 cache、copy→symlink。
- **README**：安装说明同步备份位置与 `--no-backup`。

## 5.4.1 — 2026-10-16

指向 lobe-ui `tuning-color-palettes`（patch：不改规则通过条件，不新增编号）。

- **D-07**：换品牌主色 / 定制企业色板 / 重调状态色阶时，指向 [`tuning-color-palettes`](https://github.com/lobehub/lobe-ui/tree/master/.agents/skills/tuning-color-palettes)（本机已安装则按名调用）；本规则仍只覆盖具名主题声明。`refs:meta` 为 D-07 补上品牌色 / 色板 / 调色等触发词，便于 refs 路由命中。
- **50-visual**：聚焦与症状表注明「改主题色本身」不在本 stage，改去上述 skill。
- **30-structure**：D-07 加载行加同一指针。
- **SKILL.md「与参考技能的关系」**：新增色板调参条目，并澄清本目录仍只有一个 `SKILL.md`。

## 5.4.0 — 2026-10-16

新增 75-copy 界面文案 stage（minor：不删规则编号，不改 W- 的编号与归属；新增 stage、T- 编号、`tier: profile` 与两条 WARN lint；「文案」关键词从 40 改归 75）。结构与经验参考 [Tech-Doc-Style-Chinese](https://github.com/Fenng/Tech-Doc-Style-Chinese)（MIT，Fenng），按界面短文案改写，未整段照搬。

- **新增 stage `75-copy`**（70 之后、80 之前）：只管「怎么说、怎么排」。输入 00 brief + `product.md` 的 `copy-profile` + 40 / 70 的交接；输出 profile、术语表、旧 → 新改动、lint RESULT、待确认。挂进 `operate-build`（… → 70 → 75 → 80）与 `product-polish`（… → 70 → 75 → 80）；精细指令「改文案 / 措辞 / 中英文空格 / 标点」直达 75。
- **新增 T- 编号**：`copy-core.md` T-01..T-09（范围与优先级、zh-CN 留白 / 标点 / 数字单位、术语原样与状态词、句式、人称、i18n 键值、en 简注）；四份 profile：`copy-consumer.md` T-10..T-13、`copy-saas.md` T-20..T-23、`copy-admin.md` T-30..T-33、`copy-devtool.md` T-40..T-43。`ruleOwners.T = 75-copy`。
- **渐进式披露**：新增 `tier: profile`（互斥分支，只读选中的一份）。`refs.mjs` 加 `--profile` / `--root`，选择顺序 `--profile` → `.agents/ux/product.md` 的 `copy-profile:`（支持按路由分区）→ 指令触发词 → 都没有就提示先选。`check-structure` 校验 profile id 唯一、带 triggers、只由一个 stage 整组登记；ID_RE 加 `T`。
- **与 W- 去重**：W-01..W-07 编号与归属不变，`copy.md` 写明分工（W 管有没有、讲没讲到；T 管怎么说）。40 / 70 / 80 / 00 / 20 / 30 / 50 的「不负责」与回流表指向 75；80 只留一条文案核对项，细则在 75。
- **lint（WARN，默认）**：`LOBE-CJK-LATIN-SPACE`（T-02，中文与英文 / 数字之间缺空格）、`LOBE-HALFWIDTH-PUNCT`（T-03，中文里夹半角 `, ; : ! ?`）。只看含中文的字符串字面量与 JSX 文本，去掉插值、URL 后判断；目录里的 zh-CN 语言包（`locales/zh-CN/*.json` 等）只跑这两条。fixtures：`bad-copy.tsx` / `good-copy.tsx`。
- **05-init**：Round 1 的 `product.md` 增加 `copy-profile:` 行与人称（I-07）；托管块与 `project-scan` 提示同步。
- route-cases：宏观 operate-build / product-polish 带 75；「优化一下删除确认框的文案」改为中等 40 + 75；新增 4 条 75 用例。LRN-20261016-02。

## 5.3.0 — 2026-10-16

对齐 lobe-ui 6（minor：不删规则编号，不改 stage 与路由）。规则只写 6.x 的现行用法，不讲怎么从旧版本升级。

- **C-01 重写**：组件从 `@lobehub/ui` 根入口取用，独立入口只有 `@lobehub/ui/form`、`@lobehub/ui/pro-table`、`@lobehub/ui/dashboard` 等；应用不用 `antd` / `antd-style`；「需要 → 用」表（卡片 `Block`、常驻导航 `ConsoleNav` / `SideNav` / `List`、命令式弹窗需 `ModalHost`、`DropdownMenu` 默认点击打开、`SplitButton` 等）。删掉「顶层导出禁用清单」与「等价导入」两段。
- **C-02 / C-03 / C-05 / C-06 / C-08 / C-11**：去掉 `base-ui` / 顶层的来源区分；`DatePicker` 值为 `Dayjs`；`Text` 默认块级、行内用 `as="span"`；常驻导航不再指向 `Menu`，页内目录只用 `Anchor`；删除 `FormModal`、`Toc`、双 `List` 的对照行；C-06 加 `@lobehub/ui/pro-table`、去掉 `static-css`；主题变量示例改为 `--lobe-*`。
- **design.md**：D-07 主色 / 中性色走 `data-primary-color` / `data-neutral-color`（`setLobeTheme` / `LobeThemeScript` / `ThemeScope`）；D-08 外观走 `data-theme`；D-04 字体来自 `theme.css`，自定义字体走 `ConfigProvider`；D-10.5 改为不写 `.ant-` 与哈希类名，新增 D-10.8 样式层叠（全局 reset 放进 lobe-ui 之前的层）。
- **30-structure 硬性前提**、ecosystem 安装清单（去掉 antd / antd-style，`motion` ^13 | ^14，`@lobehub/icons` ^6，`@lobehub/fluent-emoji` ^5）、craft / aesthetics / evaluator / 20-direction / init / admin-archetypes / SKILL.md / README 同步。
- **lint**：`LOBE-ANTD-IMPORT` 拦任何 `antd` / `antd-style` 导入；`LOBE-FORM-ENTRY` 只认 `@lobehub/ui/form`；`LOBE-ANT-VAR-OVERRIDE` 同时拦 `--lobe-*` 的 `!important` 覆盖；`LOBE-CREATE-STYLES` / `LOBE-ANT-CLASS` / `LOBE-FONT-FAMILY` / `LOBE-REIMPLEMENT-ATOM` 等提示改为现行写法。`check-detail` 的标签判断改认 `Form.Field`。fixtures 全部改为 `@lobehub/ui` 导入。LRN-20261016-01。

## 5.2.0 — 2026-10-16

安装后两轮自迭代：产品画像 + 组件盘点（minor：新增 I-07..I-09、`project-scan.mjs`；扩展 05-init 与托管块；不改 stage 编号与场景优先级）。

- **05-init 扩展为三步**：① `bootstrap.mjs` 写入 AGENTS.md 托管块；② Round 1 扫描仓库写 `.agents/ux/product.md`（平台 / 产品类型 / 用户 / 核心任务 / 规则适用性）；③ Round 2 扫描项目组件写 `.agents/ux/components.md`（薄包装 / 与 lobe-ui 重复 / 业务组件用法）。**不改应用代码、不跑 build、不记实现细节。**
- **新增 `scripts/project-scan.mjs`**：只读收集 package.json、框架（Next/Vite/Expo/RN/Electron/Tauri…）、路由与组件目录、README / i18n；`--check` 缺文件 → exit 1，指纹或 skill 版本过期 → WARN。文件头 `<!-- lobe-design-init: version=… fingerprint=… -->` 供幂等与过期检测。
- **新增 I-07 / I-08 / I-09**（`references/init.md`）：产品画像、组件盘点、触发与升级过期；I-02 / I-04 / I-05 / I-06 同步（项目层含 `components.md`；日常先读项目层；skill 目录保持通用，重装不覆盖 `.agents/ux/`）。
- **bootstrap 托管块**：无 `.agents/ux/` 时提示装完先初始化；有项目层时列出 `product.md` / `components.md` 并写明两轮与「先读再进 stage」；触发表增加「初始化 / 升级后刷新」。`--check` 对项目层缺失 / 过期打 WARN（不单独 FAIL）。
- **install.sh** 安装成功后提示跑 bootstrap + 对 Agent 说初始化。
- **README** 顶部新增「快速开始」：安装、两轮 init、日常流水线、升级、自迭代 / 回流。
- tests：`project-scan` CLI 与结构、bootstrap 项目层 WARN / `components.md` 指针；结构与 learnings 全绿。

## 5.1.0 — 2026-10-15

评测 / 实验控制台的可视化与交互经验（minor：新增 reference 编号 K-11、P-09；不改 stage 与路由）。来源是对一个开源评测框架的运行查看器与文档站的分析，按「产品无关」闸门分流。

- **新增 K-11 对比视图**（通用，归 50-visual）：差值和基准一起出现；好坏看指标方向不看符号；写清对齐口径，新增 / 移除单列；项目多时给「只看不同」；两边身份可读；样本少或口径不同时不给差值。`pipeline.json` 50-visual 的 `allowedRuleIds` 加 K-11。
- **新增 P-09 评测 / 实验对比**（场景限定，admin-archetypes）：第一屏优先级、层级导航（同级切换器、可读 ID）、必须有的状态（停滞、总数下限）、常见错法，以及「场景 → 可视化 / 交互」表：计数条、参数矩阵、多运行对比、类别回归、失败归因（按维度数选图、按区分度默认选指标）、刷选下钻、运行进度投影、执行树、证据查看。`refs:meta` 加 P-09，00-brief 改为 P-01..P-09。
- 判为已覆盖、不新增：状态色固定不随主题色变（D-03 / K-08）；骨架只给首次加载、刷新原地进行（K-05 / C-02）；部分失败只补失败的那块（K-05）；看板数字要有基准、能下钻（P-01）；图表要写口径（K-08）；图标按钮写可访问名（C-12）。LRN-20261015-01。

## 5.0.0 — 2026-10-14

聚焦通用设计规则，组件 bug 归 lobe-ui（major：删除规则编号）。lobe-design 只记「哪个场景用哪个组件、信息怎么排、流程和文案怎么写」；组件丢属性、默认值不对、换行或塌陷这类问题，以及它们的绕法，归组件库处理。

- **移除 C-14**：组件问题，归 lobe-ui。`Select` 空值、`AutoComplete` 只按 `value` 过滤、`showSearch` 只按 `label`、`InputNumber` 精度都是组件行为与绕法，组件修好后不成立；30-structure 症状行同步删除，LRN-20261014-19 改 `status: rejected`。
- **移除 C-16**：组件问题，归 lobe-ui。`Input` / `Select` 默认满宽、`Grid` 的 `rows`、`Text` 默认块级、`Tabs` 无外边距、`Empty` 默认排版都是组件默认值；「失败用带叉图标并配重试」已在 K-05 / W-04。症状行同步删除，LRN-20261014-21 改 `status: rejected`。
- 条目内精简（编号保留）：C-12 只留「名字来自可见标签、图标按钮写 aria-label、在可访问性树里验收」，删组件丢 `aria-*` 的绕法；C-15 只留确认文案、等写入完成、链接行不放按钮、二级选择用菜单，删 `ModalHost`、`onOk` Promise、`key` 重挂载、portal 冒泡、`Tooltip` 子节点；C-17 只留就地编辑与回显，删 `borderless` 间距、`FormField` 上下文、`key` 重挂载。30-structure 的 C-15 / C-17 症状行改写。
- **回流判据第 6 条**：组件问题不回流（CONTRIBUTING「什么该回流」表、六条机械判据、PR 自检；`upstream.mjs` 识别 `scope: component-bug` 或根因写明组件 bug；SKILL.md、README 同步）。
- **新增判据（来自 4 个项目重排）**：K-05「部分失败只补失败的那块」，重试只重跑失败的查询；W-07「不工作的东西直接删」（占位图、切换后不变的控件、重复的数）；P-06 队列默认先进先出，常见错法补「按创建时间倒序」。LRN-20261014-27 / 28。
- **lint 误报**（LRN-20261014-29）：`LOBE-FONT-FAMILY` 按值判断，`cssVar.*` / `token.*`、`inherit` / `unset` / `initial` / `revert` 与「cssVar 或 undefined」三元不再报；`LOBE-OUTLINE-NONE` 改为按样式块判断，不可聚焦的 SVG 图形（`path`、`Geography`）和同块有 `:focus-visible` 可见替代时不报，可聚焦元素上照报。K-07 补一句例外。新增 `good-fp-copyable.tsx`、`good-fp-model.tsx`、`good-outline.tsx`、`bad-focus.tsx`。

## 4.1.0 — 2026-10-14

托管块模板随宿主项目布局变化（minor：模板行为变化、新增 reference 编号 I-06；不改 stage 与路由）。

- **bootstrap 安装路径**：`--root` 下有 `.agents/skills/lobe-design` 时，托管块默认启用 `LOBE_DESIGN="./.agents/skills/lobe-design"`，全局路径改为注释；否则保持原默认。新增 `detectContext()`。
- **新增 I-06 项目层规范指针**：有 `.agents/ux/` 时，块内按固定顺序列出实际存在的 `product.md`、`lobe-design-rules.md`、`cases.md`、`stack.md`、`audit/`，并写明 00-brief 入口（先读 `product.md`）。宿主项目不必再在块外手写同样的指针。
- **自迭代拆成两层**（块内第 3 节、I-03）：宿主项目记进项目层规则文件（有 `.agents/ux/` 时为 `.agents/ux/lobe-design-rules.md`），不改已安装的 skill、不 bump 版本、不写 skill 的 LOG；通用经验回流落地后，才在 skill 仓库里走版本、CHANGELOG、`learnings/LOG.md` 与 `tests/run.mjs`。
- **I-01**：注明 `CONTRIBUTING.md` 只由人或 Agent 阅读，`bootstrap.mjs` 的 `CANDIDATES` 不含它。
- 05-init 的聚焦、输入、只加载与检查清单同步；tests 补安装路径、ux 指针、两层自迭代与幂等的用例。

## 4.0.0 — 2026-10-14

规则精简（major：删除规则编号）。按「过时 / 小众 / 组件已修复 / 非设计（只关于 API、类型或 import，没有设计后果）」四条筛过全部 reference，只留「哪个场景用哪个组件 + 注意点」，不记实现细节。

- **移除 C-13**：非设计。`Alert` 的 `message` → `title` 是 API 迁移，类型与废弃告警已覆盖，没有设计判断；30-structure 症状行同步删除，LRN-20261014-18 改 `status: rejected`。
- 条目内精简（编号保留）：C-04 删 `LLMMessage` / `ChatMessage` 类型说明；C-08 删 `surfaceStyles.card` 与 `renderLink` 透传的实现说明；C-15 删 `nativeButton` 与 `element.click()` 两条；C-16 删 `Flexbox` `horizontal` 与 `Alert` 480px 两条；D-03 删底层色阶映射；D-05 删原始色阶 import；E-01 删 `AccuracyBarChart` 未实现 props（5.7.0 仍未实现，小众）、`FunnelChart` `showArrow`、`Heatmaps` `maxLevel`。

## 3.1.0 — 2026-10-14

消费方回流（minor：新增 reference 编号、修订已有规则；不改 stage 与路由）。来源是 4 个消费项目里重复出现、且在非控制台界面（对话、设置、落地页）同样成立的组件用法与状态处理经验。按 CONTRIBUTING 的五条判据加「产品无关」闸门筛过，控制台专属的条目留在项目层。

- **新增 C-12** 可访问名：属性写了不等于落到 DOM（`Switch` / `Select` 丢 `aria-*`、`ActionIcon` 的 `title`、`Checkbox` 名字重复）。
- **新增 C-13** 新旧 prop 并存时以新的为准（`Alert` 的 `title ?? message`）。
- **新增 C-14** 选择与数字输入的取值陷阱（`Select` 空值、`AutoComplete` 只按 `value` 过滤、`showSearch` 只按 `label`、`InputNumber` 精度与千分位）。
- **新增 C-15** 浮层、菜单与命令式弹窗的接线（`ModalHost`、`okText` 默认英文、`onOk` 等 Promise、`nativeButton`、portal 冒泡、`Popover` 里用 `DropdownMenu`、`Tooltip` 子节点必须是元素）。
- **新增 C-16** 原子件的默认排版（`Input` / `Select` 满宽、`Grid` 的 `rows` 是列数、`Text` 默认块级、`Flexbox` 的 `horizontal` 优先、`Tabs` 无外边距、`Empty` / `Alert` 的默认排版）。
- **新增 C-17** 表单：就地编辑、独立字段（`FormField`）与重置。
- **修订 C-02 / C-05**：`SearchBar` 的 `mod+k` 只聚焦本框；「没有的组件」补命令面板的组合方式。
- **修订 K-05**：失败不是零条、加载中不画空态、读失败由数据所在表面负责并用稳定 toast `id` 去重。
- **修订 K-10**：定高纵向 flex 会把 `overflow` 非 `visible` 的孩子压扁。
- **修订 E-01 / E-03**：`NoData` 默认英文与 `loading`；具名品牌用 avatar 变体，`ProviderIcon` 先把业务 id 折成关键字。
- stage 症状表：30-structure 增加 C-12..C-17、C-05、K-10、E-01、E-03 的症状行；70-detail 新增「症状 → 规则」并登记 K-05。
- **W-06 空值占位统一为 `--`**（两个连字符），`—` 不再作为空值；`LOBE-NULLISH-RENDER` 改为报 `—` / `–` 而放行 `--`，`bad.tsx` / `good.tsx` 补对应正反例；X-2.2 同步。
- learnings：LRN-20261014-17..26 记账，均为 `layer: rule`、`occurrences ≥ 2`。

## 3.0.1 — 2026-10-14

仓库重整（skill 迁到 `skills/lobe-design/`）+ 修路由漏报。规则语义未变，属 patch。

- **仓库结构**：`skill/` → `skills/lobe-design/`（与 skills 仓库惯例一致，可整目录拷贝 / symlink 安装）。新增根 `README.md`（含各场景 prompt 模板）、`install.sh`、`LICENSE`、`.gitignore`、`.github/workflows/ci.yml`、`.claude-plugin/` 清单、根 `AGENTS.md`（由自身 bootstrap 生成）。
- **清理**：删除 `temp/`（第三方参考 clone + playbook，786MB）、`.backup/`（已被 git tag `backup/pre-pipeline-refactor-20261014-141721` 完整覆盖：manifest 12/12 逐字核对通过）、12 个 `.verify-*.sh|.out.txt` 临时脚本。bootstrap 的文件系统级验收折进 `tests/run.mjs`，不再依赖外部脚本。
- **新增路由信号**：会话 / 对话 / 聊天 / 消息流并入 `operate-build`（LobeHub 核心页面类型，此前「做一个会话页」会落到模糊指令）。
- **新增 `modelSignals`**：模型的口语说法（双钻 / 格式塔 / 尼尔森 / Kano / 峰终 / 福格 / 旅程地图 / 认知负荷）→ 规则 id，由路由器在第 1 步解析。此前模型词挂在 stage 的 `keywords` 上，导致两个问题：`00-brief` 被排除在关注点表外（只归 00 的词永远解析不到）、同一模型挂多个 stage 时命中两次。
- **补 `ruleOwners`**：M-06（福格）、M-08（认知负荷）此前没有归属 stage，`modelSignals` 会解析到空。
- **`check-structure.mjs`**：新增 `model-signals` / `model-signals-dual` 校验（每个模型词都能解析到唯一归属；模型词不得同时混在 stage keywords 里）；`repoRoot` 改为向上查找 `.git`，否则迁移后单入口检查只会扫到 `skills/` 而不覆盖整个仓库。
- **`bootstrap.mjs`**：托管块改用 `$LOBE_DESIGN` 指代 skill 安装位置。消费方项目里 skill 不在仓库根，原来写 `node scripts/route.mjs` 是误导。
- 回归：179 PASS, 0 FAIL（结构校验 66 PASS）。

## 3.0.0 — 2026-10-14

六项能力升级（major：新增 stage、新增场景、路由新增归一化层）。

- **经典模型层**：新增 `references/models.md`（M-01..M-08：双钻、格式塔、尼尔森十大启发式、Kano、峰终、福格、旅程地图、认知负荷）。每个模型挂载到具体 stage 并规定必须产出的字段：M-01/M-04 → 00，M-05 → 20，M-01/M-06/M-08 → 40，M-02/M-08 → 50，M-02/C-11 → 60，M-03/M-07 → 70。`ruleOwners` 新增 `M-*`；`check-structure.mjs` 的规则编号正则与白名单同步支持 `M` 命名空间。
- **组件分层松绑**：`components.md` 新增 C-11「分层边界：原子层取用，组合层自建」（原子层 / 皮肤层 / 组合层 / 领域层四层，附三条自建判据）。C-01 的硬性约束明确限定在**原子层**；C-02 加注为原子层与皮肤层的选型表。新增 lint 规则 `LOBE-REIMPLEMENT-ATOM`（WARN，C-11）：在项目里重写原子层组件时报警——反过来的误用（组合层自建）不报。
- **初始化流程**：新增 stage `05-init`（项目接入与初始化）与 `references/init.md`（I-01..I-05：探测顺序、AGENTS.md 托管块、自迭代规则、幂等、边界）。新增 `bootstrap` 场景（优先级最高，信号：初始化 / 接入 / agents.md / 项目指南）。新增 `scripts/bootstrap.mjs`：探测 `AGENTS.md` → `CLAUDE.md` → 都没有则建立，把入口与顺序、触发条件、执行纪律、自迭代规则写进托管块；**块外内容一字不改**（只做块级替换），支持 `--check` / `--print` / `--root`。00 新增 `project` brief 模式。
- **抽象指令翻译**：新增 `scripts/intent.mjs` 与 `pipeline.json` 的 `intentSignals`（8 组）。「体验不好 / 丑 / 难用 / 太乱 / 看不清 / 找不到 / 太慢 / 有点土」归一化为**可执行表述 + 要说明的量 + 目标 stage**，并并入关注点参与路由；归一化不了的（「感觉不对」「说不上来」）进入新的 `clarify` 颗粒度，先追问不猜着动手。
- **refs 渐进式披露**：每份 reference 顶部新增 `refs:meta` 块（`tier` / `scope` / `entries`）。`tier: flat` 整份加载；`tier: index` 只加载 `always` 条目 + 命中本次指令的 `deep` 条目，其余只读标题。新增 `scripts/refs.mjs`（按指令解析每个 stage 的加载条目，`--audit` 审计 tier 与预算）。`check-structure.mjs` 新增 refs-meta 校验（块存在、tier 合法、index 必须有 entries、声明的编号必须真实存在）。`components.md` 48KB，一次任务通常只命中 C-01 + 2–3 条。
- **消费方回流**：新增 `CONTRIBUTING.md` 与 `scripts/upstream.mjs`。回流判据机械化：`landed` 且带版本 · 层在 `structure/lint/rule`（style 不回流）· `occurrences ≥ 2` · 不含品牌或项目专有名词 · symptom / root_cause / artifacts 齐全。
- **路由**：`granularity` 新增 `clarify`；点名规则时只统计能真正解析到 stage 的 id（避免散文里的 `lobe-design` 被当成 lint id）；被点名的是 00 自己的规则时不再把 00 排两遍。
- 回归：新增 `bad-composite.tsx` / `good-composite.tsx`（C-11 正反例）、refs 披露、bootstrap 幂等（块外内容不变）、intent 归一化与 `clarify` 的用例；`tests/run.mjs` 增加对应小节。

## 2.1.2 — 2026-10-14

修复「工作区只有一个入口，git 提交里却仍有 6 个」。

## 2.1.2 — 2026-10-14

端到端验收（T-7）修复（patch：不改变任何 lint / detail 规则的通过条件）。

- `check-structure.mjs`：新增 `single-entry-git`，用 `git ls-files` 校验**提交树**中也只有一个 SKILL.md（忽略 temp/、.backup/）；非 git 目录自动跳过（LRN-20261014-08）。
- 提交 `projects/*` 的删除：此前 5 份按项目复制的 SKILL.md 只在工作区删除，git HEAD 仍是 6 个入口。原内容保留在 git tag `backup/pre-pipeline-refactor-20261014-141721` 和 `.backup/` 归档中。
- 文档数字更正：check-detail 为 9 条规则（原文误写 10 条）；LOG 条目数更新为 8。

## 2.1.1 — 2026-10-14

路由一致性修复（patch：不改变任何检查规则的通过条件），并新增维护者文档。

- `route.mjs`：点名的规则编号优先于关键词。`LOBE-*` 按 lint 规则自身的 `stage` 路由，`DETAIL-*` 路由到 70；此前「LOBE-RAW-COLOR 报错」被「报错」带去 70，与 lint 报告的 50 不一致。
- `route.mjs`：`X-n.n` 清单编号可路由（`ruleOwners.X → 70-detail`）；此前「修一下 X-3.6」被判为模糊指令。
- `route.mjs`：已有视觉页只带打磨信号、无新建信号时降为 product-polish，不再跑 20 重定方向（与 SKILL.md「launch-visual 和 product-polish」的区分一致）。
- `pipeline.json`：「重新设计」「重新做」加入新建信号；「重新设计」加入宏观信号。
- `tests/route-cases.json`：为以上修复各加回归用例（共 26 条）。
- 新增 `docs/REFACTOR_NOTES.md`（位于 skill/docs/，随 skill 一起分发）：问题诊断、架构图、颗粒度取舍、路由规则、自进化、对两个参考技能的借鉴边界、三类指令路由演练。
- `README.md`：补上 2.1 后的脚本与目录（check-learnings、learnings/、docs/）。

## 2.1.0 — 2026-10-14

审美、体验细节与自进化资产落地为可执行检查。

- 新增 lint 规则（默认 WARN，除注明外）：
  - `LOBE-FONT-SIZE-SCALE`（A-02 字阶档位与拥挤度）
  - `LOBE-LETTER-SPACING`（K-02 加宽字距）
  - `LOBE-SPACING-OFFGRID`（A-05 间距不在 4px 网格）
  - `LOBE-ANIMATE-LAYOUT`（K-06 动画布局属性）
  - `LOBE-REDUCED-MOTION`（A-06 动画未处理 prefers-reduced-motion）
  - `LOBE-GRADIENT-ANIMATION-OVERUSE`（A-07 品牌渐变一页 > 2 处）
  - `LOBE-MULTI-PRIMARY`（W-01 多个主 CTA）
  - `LOBE-FIXED-WIDTH`（D-09 写死 ≥ 480px 宽）
  - `LOBE-IGNORE-NO-REASON`（L-06 豁免必须写理由；无理由豁免不再生效。例外：直接 FAIL，因为它只约束新增的豁免注释，存量代码零命中）
- check-detail 新增：`DETAIL-NO-RETRY`、`DETAIL-NO-RESULT-FEEDBACK`、`DETAIL-DANGER-NO-CONFIRM`、`DETAIL-DISABLED-NO-REASON`、`DETAIL-INPUT-NO-LABEL`。
- 所有脚本提供 `--help`、路径参数校验与统一退出码（0 通过 / 1 FAIL / 2 用法错误）；lint 支持 `--stage` / `--only`，`--rules` 显示 `since` 版本。
- 新增 `scripts/check-learnings.mjs`：校验结构化经验日志、回写约束 L-01..L-05、规则 ↔ 回归 ↔ 版本一致（V-01..V-03）。
- learnings/ 改为结构化 ```learning 条目；README 写明选层流程、确定性判定、lint 回写七步与版本化策略。
- references：aesthetics 新增 A-08 视觉密度取数表、A-09 LobeUI 兼容速查，A-02/A-05/A-06 标注 lint；detail-checklist 新增 X-3.6/3.7、X-4.5..4.7、X-7.5 与执行顺序。
- 真实代码校准（lobehub/src/features，634 个文件有命中）：`LOBE-FIXED-WIDTH` 排除 media query / matchMedia 并只认 px 值；lint 与 detail 跳过 *.test / *.spec / *.stories；脚本改用 exitCode，管道输出 --json 不再被截断（LRN-20261014-07）。
- 回归：新增 bad-visual / good-visual / detail-good / learnings-bad fixture；tests/run.mjs 增加「无意外 finding」、learnings 闸门与 CLI 契约检查。

## 2.0.0 — 2026-10-14

- 单入口分层 pipeline：SKILL.md 只做路由与契约；stage 由 00–04 五个调整为 00/10/20/30/40/50/60/70/80 九个，新增截图解析（10）、视觉方向（20）、系统统一（60）、细节加固（70）。
- 六类场景识别与 pipeline 映射写进 `scripts/pipeline.json`，由 `scripts/route.mjs` 执行。
- 新增 references：aesthetics（A-）、copy（W-）、detail-checklist（X-）。
- 新增脚本：lint-lobe.mjs、check-detail.mjs、check-structure.mjs；回归：tests/run.mjs。
- 修复：components.md 中悬空的 K-16 引用。
- 原版本备份：`.backup/20261014-141721-pre-pipeline-refactor/` + git tag `backup/pre-pipeline-refactor-20261014-141721`。

## 1.x

- 见 git 历史（HEAD 6653166 及之前）。

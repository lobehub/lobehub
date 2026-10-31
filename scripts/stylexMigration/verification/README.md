# StyleX 迁移验证器

当前实现是 M1 的本地基础链路，不是已经上线的 PR 合入门禁。完整设计见 [Spec](../../../docs/development/stylex-migration-verification-spec.md)。

## 已可运行

```bash
# 只解析版本、变更清单和缺口，不导出完整源码
bun run stylex:verify --base <base-ref-or-sha> --head <head-ref-or-sha> --plan-only

# 同时导出两侧完整源码树，包括 workspace 源码
bun run stylex:verify --base <base-ref-or-sha> --head <head-ref-or-sha>

# 显式恢复隔离依赖，默认只允许离线缓存
bun run stylex:verify --base <base-ref-or-sha> --head <head-ref-or-sha> --restore-dependencies

# 使用已有 pnpm store；首次联网准备必须显式授权并添加 --dependency-network
bun run stylex:verify --base <base-ref-or-sha> --head <head-ref-or-sha> \
  --restore-dependencies --dependency-store <store-path> --fixture LiteTable

# 组件诊断：独立恢复夹具 / 编译器依赖，不安装无关后端 workspace
# 首次联网需授权；后续恢复阶段仍严格 offline + frozen
bun run stylex:verify --base <base-ref-or-sha> --head <head-ref-or-sha> \
  --restore-dependencies --dependency-network --fixture LiteTable --fixture-dependencies

# 同一 B/M 源码与依赖准备一次，按组件分别构建、验证并保留报告
# 每个组件的错误单独记录，继续运行剩余组件；不是跨 PR 的批次 DAG
bun run stylex:verify --base <base-ref-or-sha> --head <head-ref-or-sha> \
  --restore-dependencies --dependency-network --fixtures DotsLoading,UnreadDot --fixture-dependencies

# 只读解析 GitHub PR；需要 gh 和本地已存在的 commit objects
bun run stylex:verify --pr 21447 --repo lobehub/lobehub --plan-only

# 33 个原有语料、11 个采集断言、17 个准备/对照断言、11 个规则见证用例、8 个门禁链路回归及 66 次标准树对照
bun run stylex:verify self-test
```

默认使用 Playwright 安装的 headless shell。`self-test --browser <path>`、`--fixture ... --browser <path>` 和 `--fixtures ... --browser <path>` 可指定浏览器。组件构建当前只有 macOS sandbox adapter；其他平台报错，不退回无沙盒执行。Linux 隔离构建属于后续工作。

`--repository <path>` 指定本地 Git 仓库，`--output <parent>` 指定产物父目录；每次创建独立目录，不覆盖已有报告。默认输出到 `.records/stylex-verification/`，这些产物仅保存在本机，不代表 CI 已发布。

CLI 由 Bun 编译后交给 Node 运行。不使用 tsx 启动浏览器采集，避免序列化到页面中的函数被插入外部 helper。

## 本地测试入口

验证器、实验采集和 `sx()` 类型契约的测试是本地工具测试，不参与普通 App / Server CI 的测试发现；原有迁移 codemod 测试和产品 `src/styles/sx.test.ts` 仍照常运行。没有关闭应用测试、E2E 或覆盖率检查。

```bash
# 显式运行这套本地工具测试，不启动全仓 App / Server 测试
bun run stylex:verify:test

# 也可只运行一个用例文件
bun run stylex:verify:test scripts/stylexMigration/verification/__tests__/cliIntegration.test.ts

# 浏览器语料仍使用独立的显式本地入口
bun run stylex:verify self-test
```

独立配置使用 Node 环境、不加载应用 setup，以有限并发运行；包含多次 CLI 子进程的测试使用 60 秒外层超时，每次子进程仍保留自己的超时。`testDiscovery.test.ts` 验证实际 App / Server 测试发现结果和本地配置，防止本地测试再次混入 CI；它自身也只在本地入口中运行。

## 当前能够保证什么

- 固定 B/H，生成实际合并候选 M，比较 B → M。base 的并行改动不会丢失。
- 合并对象只写入临时 bare 仓库；不修改用户的 refs、index、工作区或 object database。临时仓库在正常完成或异常时清理。
- shallow 仓库仅在 B/H 到公共祖先之间没有被截断的历史时接受；无法证明则错误退出，不自动 fetch。
- 按 Git blob 导出完整源码，不从脏工作区借文件，不把 `@/` 指向当前 checkout。默认不安装依赖、不执行组件；只在显式恢复和夹具模式下执行后续阶段。
- 保留所有变更文件及两侧 source/style-slot/stylesheet/opaque 条目；用 TypeScript AST 识别样式工厂及槽位。未挂载槽位不会因为没有 DOM 命中而消失。
- source 和 opaque 条目是有意保守保留的缺口；槽位也尚未细分到条件 IR，清单数不等于组件数、规则数或覆盖率。
- 导出阶段的依赖状态仍为 `NOT_RESTORED`；不能把依赖输入 hash 当作完整依赖图。成功恢复后另存 `dependencies.json`，包含临时锁、解析图、包完整性、原始与可移植内容 hash，并验证冻结恢复没有漂移。
- 14 个实验组件均已登记真实入口、统一 host、surface、静态样式变体与各自的交互目标；见下节。样式单元映射仍未完成，找到或构建夹具都不会自动关闭覆盖项。
- LiteTable 的初始离散 host contract 为 176 个探针，涵盖两侧声明的 600/800px 断点附近尺寸、LTR/RTL 和行 hover/focus-visible。记录实际查询容器内容宽度；这不是自动条件 IR，也不证明任意尺寸或状态组合等价。
- 夹具明确使用 Arial 系统字体诊断，并通过 Provider 的公开选项关闭默认 CDN 字体 / 公式样式注入；不改写 UI 库源码、不放开浏览器外网。`fontContract` 与 `PRODUCTION_FONT_METRICS_UNVERIFIED` 显式保留生产字体缺口，不将系统字体结果视为生产字体等价证明。
- 采集补充 SVG / 元素属性、原始文本和伪元素专属自定义变量；缺失布局记录的节点走严格补采。未知变量保留为 review，不按变量前缀全局忽略。
- 不活跃的 CSSOM 规则、layer 名称、嵌套声明顺序、声明 important 及完整祖先条件路径保留在清单中。新增选择器 AST 和逐 DOM 目标的激活见证；完整条件分区和来源闭环仍未完成，未命中规则不能获得 PASS。
- 构建在独立 Node 进程中执行，使用相应源码版本的样式插件，审计模块实际路径。控制端仅用固定 TypeScript 转译器擦除插件类型及改写局部模块后缀，不执行插件；记录源码 / 产物 hash 与转译器版本。插件运行、Vite 构建均在沙盒内，Browserslist 查找限制在快照根。避免 Bun 在真实仓库路径下的配置 / 目录解析问题，不借此放宽权限。
- macOS adapter 拒绝写入源码 / 依赖、读取快照外用户文件和网络；组件构建只能写本组件 `.stylex-tools/fixtures/<id>/`，不能覆盖同批其他组件。这是本地执行边界，不代表 CI 安全发布已完成。
- 浏览器比较使用独立页面做 A/A、重新建立状态并确认差异一次；记录实际二进制 hash。超预算、未执行探针、资源失败及异常均保留，不能靠重试至绿色通过。
- 门禁 reducer 严格校验输入，按单元及必要 key 计算覆盖，汇总优先级为 ERROR > FAIL > NEEDS_REVIEW > PASS。
- 空节点、零比较、零属性读取、缺 fixture、漏条件、A/A 不稳定或未确认版本都不能自动通过。保留失败与覆盖缺口，不用后来的异常覆盖原有发现。
- HTML 报告转义输入、禁用脚本；产物清单记录字节数和 SHA-256。不写 GitHub，不调用 AI，不修改合入策略。

## 组件批量诊断

`--fixtures` 支持以下 14 个已登记 adapter：CollapsibleContent、CommandLine、DotsLoading、FilePathDisplay、GalleyGrid、GeneratingBorder、InlineTable、LiteTable、OptionCard、OptionRow、StatusBar、TailMarquee、UnreadDot、VersionTag。该参数与 `--fixture` 互斥，不自动扩大到其他 PR 或未登记组件。

依赖 capsule 仅加入共享 host/compiler 的 9 个入口及所选组件明确声明的依赖并集，版本取自各侧源码 manifest。i18n 夹具使用实际 locale 模块，不模拟组件 hooks；所有夹具直接加载各侧真实组件。普通组件使用一致的 wrapper；LiteTable 保留原根容器契约。ResizeObserver 相关夹具在调整尺寸后等待两帧。动画与正式字体能力仍沿用既有诊断限制。

每批输出 `fixture-batch.json`，每组件输出 `components/<id>/report.html`、`component-summary.json`、独立快照和 `artifacts.json`。子清单 hash 由外层清单覆盖；失败组件保留错误和已产生的文件。批次开始 13 分钟后不再启动新组件并记录 NOT_RUN，外层仍有 15 分钟总 watchdog；不是正式 CI 分片调度。

`sampledStyleStatus` 只描述当前样本：EQUAL_IN_SAMPLES、DIFFERENT、INCOMPLETE、UNSTABLE、NEEDS_REVIEW、ERROR 或 NOT_RUN。已确认差异不能被采样缺口抹掉；有执行错误则显示 ERROR，并保留差异计数。EQUAL_IN_SAMPLES 不是 gate PASS，未关闭的源码单元、条件、依赖 peer context 和生产字体缺口仍阻止 PR 放行。

## 退出码与报告

| 退出码 | 含义                                                  |
| ------ | ----------------------------------------------------- |
| 0      | 当前只用于验证器 `self-test` 成功，不是 PR 验证通过   |
| 1      | 自测回归，或夹具中已确认的实际差异                    |
| 2      | NEEDS_REVIEW：计划或检测尚有未关闭的缺口              |
| 3      | ERROR：版本、合并、源码、构建启动或运行错误           |
| 4      | 确认 B 与 M 完全无文件差异，NOT_APPLICABLE；不是 PASS |

准备阶段使用 `preflight.json`，不伪造包含浏览器和完整依赖身份的 `VerificationResult`。`self-test.json` 与准备阶段报告均为 `gateEligible: false`。`--plan-only` 即使输入没有差异也返回 2。

成功完成准备后，目录包含 `identity.json`、`scope.json`、`fixtures.json`、`coverage.json`、`preflight.json`、`report.html`、`artifacts.json`。完整源码模式另有 `base-source/` 和 `candidate-source/`；出错保留 `error.json` 及已写入的证据。

恢复模式另有 `dependencies.json` 和各快照 `.stylex-tools/` 下的解析 / 恢复日志、锁数据及依赖证据。夹具模式另有 `fixture-builds.json`、`probe-plan.json`、`rules-*.json`、`component-run.json` 和按内容去重的压缩快照；运行错误保留 `component-error.json`，不丢掉之前的差异。

`--fixture-dependencies` 额外生成 `dependency-capsules.json`，安装位置为快照内 `.stylex-dependencies/`；原始源码 manifest 不修改，源码根的 `node_modules` 仅链接到本侧 capsule。所有输出仍为本地诊断，不允许作为 PR 放行证据。

五个浏览器链路回归使用受控 HTML，仅验证 Infra 接线：有稳定差异应 FAIL，没有差异但缺少源码覆盖应 NEEDS_REVIEW；其余三个分别验证第二行 hover、media × named container × hover，以及 599.2–599.4px 窄区间中的差异能被自动补采发现并独立确认。小数边界不能精确实现时必须留下证据缺口。它们不代替真实 React 组件挂载。11 个采集断言中的未匹配规则用例只断言 CSSOM 没有丢规则，不会把未绑定样式判为迁移通过。

## 源码槽位与规则激活诊断

- TypeScript AST 识别 `createStaticStyles`（含导入别名）的静态返回槽位，以及 CSS Modules 导入；保存组件 hash、槽位源码范围、CSS 文件 hash 和未激活规则。条件返回、动态槽位、无法识别的来源保留缺口，不执行源码来做静态推断。
- 构建时追加只读导出，取得组件自己的实际 class 对象；同时用 TypeScript 的符号绑定定位导入的 `cx` 调用（含别名，不匹配被局部变量遮蔽的同名函数），在内存中加入组合追踪。不向 DOM 补 class、不更换被测组件。原始源码快照文件不改写；应用插桩前校验源码 hash 和编辑区间。读取器只接受数据属性，拒绝调用 getter。
- 通过实际 class 将 CSSOM 分支连接到源码槽位。一个逗号选择器拆为多个目标分支；触发元素与最终样式元素分别由 selector AST 定位。祖先、兄弟和多节点状态保留各自触发位置；当前复杂 `:has/:is/:where`、否定交互状态和原生 nesting 的完整绑定仍反馈，不删掉复杂部分后冒充支持。
- 初始探针仍保留 LiteTable 的首行单状态 contract；真实组件在首轮观测后，开始按条件分区补采。浏览器通过精确结构选择器关联单状态触发者和样式目标，支持触发者自身、祖先与兄弟关系；每次只强制一个具体节点，B/A-A/M 使用相同结构 key，并重新导航、采集和确认差异。不同时强制所有行。多状态、多触发者、关系歧义等留缺口，不猜测操作。
- 显式传入受控 HTML 探针的底层 Infra 测试仍可使用旧的最小激活补采；它仅关闭“该 DOM 目标从未激活”的诊断缺口，不证明每个尺寸 / 方向 / 条件分区都覆盖。是否启用条件调度是独立选项，不能混淆两种覆盖语义。
- 宽度条件使用 token AST，支持 px min/max、严格比较、双边范围、命名容器和 AND；OR/NOT、其他单位等保留缺口。尺寸分区现在接入真实调度，见下一节；整体源码条件覆盖仍未认证。
- 产品快照完成之后，临时使用 constructed stylesheet 和随机命名、非继承的注册属性观察原有 CSSOM 选择器 / 条件是否激活。不会插入 DOM 节点；恢复原有 adopted sheets。注册属性不能注销，因此每个后续探针都必须完整导航重置 Document，不能只换容器宽度后继续采样。
- 记录真实命名容器、内容宽度、媒体 / supports 条件结果，以及 `::before` 等的 content/display。它证明的是分支激活，不证明某条声明赢得 cascade；最终渲染值仍由独立产品快照对照。
- 新增 `rule-plan-<variant>-<side>.json`、`rule-observations.json`、`rule-coverage.json`、`supplemental-plan.json`。补采计划保留缺口、触发结构 key、原探针、调度 / 溢出项；报告区分 OBSERVED、PARTIAL_ACTIVATION、UNMOUNTED、INACTIVE_ONLY、UNSUPPORTED，这些不是 gate PASS。按变体保留观测，并另行统计所有变体都未挂载的分支，避免把空态没有表格当作全局漏测。
- 旧 Emotion 的 `cx()` 会产生组合 class，不能假定只是拼接字符串；现在记录原调用的输入字符串、返回 class 和调用位置，支持嵌套合并的来源传播。原函数只执行一次，返回值 / 异常不替换；不读取对象、数组或 getter 来推断输入。非支持参数、别名函数引用、未知 class 来源和追踪预算溢出留缺口。
- 组合 class 目前只归因到参与槽位的并集，不证明每条合并声明的具体来源；原始 class 没有 DOM 命中仍如实保留，不将原始 / 合并规则视为逐声明等价。首探针之后出现的新组合也未认证。`COMPOSITION_DECLARATION_OWNERSHIP_UNPROVEN`、`COMPOSITION_TRACE_SCOPE_LIMITED`、旧模板规则闭包、CSS Modules 逐声明来源与完整覆盖 key 仍未闭环，不向总门禁伪造 witness。
- 当前本地诊断已接入有界执行片，每片最多 64 探针 / 30 秒，见下节；整夹具超过 Spec 的 256 探针或 30 秒预算仍明确报告 `FIXTURE_TOTAL_PROBE_BUDGET_EXCEEDED` / `FIXTURE_TOTAL_BUDGET_EXCEEDED`，不是达到正式性能门槛。正式跨任务的可信分片汇总仍未实现，不允许因此得到 gate PASS。
- 首轮真实接入（`run-Qslz7K`）：176 个探针完成，A/A 零不稳定，48 个差异探针确认；与前轮 `run-VHWOzu` 的 528 份产品快照逐份内容一致。诊断能定位第二行未触发 hover/focus、`extra` / 无标签单元格未挂载等具体缺口。360 个分支条目包含两侧及五种变体的重复观测，不是 360 个源规则，也不是整体覆盖率。

11 组浏览器规则见证回归覆盖：标记不继承 / 第二个目标未触发、命名容器 content-box、滚动条尺寸未证明时留缺口、伪元素、media × container、原生 nesting 留缺口、复杂选择器不伪造支持、无 DOM 插入、祖先与兄弟触发者的逐目标绑定和 getter 不执行。它们还验证清理前后标准计算属性 / 布局不变；adoptedStyleSheets 是 live 数组，必须保存副本再恢复。

## 条件分区调度与证据复用

- LiteTable 声明 host 内容宽度 320–920px、viewport 宽度 320–1200px 的诊断范围。首探针从两侧源码绑定的 CSSOM 和真实 DOM 观测生成计划；默认开启，不读取历史报告作为当前输入。
- 对同一 DOM 目标上的 B/M 条件取并集，保留精确边界和相邻开区间。优先使用原有探针代表区间；没有可用样本时取内部点。media 控制真实 viewport，container 仅控制经过来源绑定的宿主内容宽度。命名容器必须是实际最近的有效祖先；其他容器或非支持 writing-mode 保留缺口，不代调别的元素。可能产生滚动条或预留 gutter 的容器，不能只根据 computed width 减 padding/border 证明查询尺寸，保留 `QUERY_CONTENT_METRICS_UNSUPPORTED`，不将其计算真值冒充已测量真值；精确滚动条适配尚待实现。
- 只在同一目标的条件维度之间规划交集，避免把无关节点的 media/container 全局相乘；祖先、兄弟、继承和流式布局影响的完整闭包尚未证明，始终保留 `CONDITION_INFLUENCE_CLOSURE_UNPROVEN`。
- 每个诊断 key 记录侧别、源码单元、CSSOM 分支、DOM key、方向、host/viewport 分区、条件真值、单状态操作和所需 probe ID。命中与非命中分区均保留；一个节点或区间的命中不能关闭另一个。
- 证据检查实际方向、viewport、查询容器的身份 / 内容宽度、谓词结果及 marker 激活，并要求独立 A/A 稳定和产品快照引用。小数宽度受浏览器布局量化影响，不能用宽松 epsilon 将未实现的精确边界记为覆盖；区间内部点仍可有效采样。
- 剪枝目前仅复用完全相同的环境与具体节点操作，不合并同 class 的不同行，也不删掉原有 176 点离散宿主契约。查询真值相同不能证明任意流式表达式等价，始终保留 `FLUID_LAYOUT_EQUIVALENCE_UNPROVEN`。因此本阶段可能增加探针，不能把“规划已接入”说成“性能已达标”。
- 初始及新增探针在受限执行片中运行，按具体节点 / 状态 / 方向轮转调度，避免先铺满第一行的尺寸后，其他行完全得不到样本。计划容量不超过受信诊断策略的 64 × 16 个探针；变体边界或时间换片也可能提前耗尽片数。超出的探针、所需 key 和未挂载 / 非支持绑定保留在计划中；未执行、A/A 不稳、容器变化、真值不符等分别标为缺口。不会通过截断需求获得 PASS。条件 key 数也有独立上限，超预算保留对应规则的 blocker。
- 新增 `condition-plan.json`、`condition-coverage.json`；`component-run.json` 和准备报告汇总 required/observed/missing、复用、溢出及分阶段耗时。导航与就绪、采集、比较、持久化、差异确认、见证和规划分别计时，供后续性能优化使用。
- 这些 key 仍是诊断证据，不直接交给正式 gate reducer。旧模板 / 组合声明来源、完整影响闭包及未挂载规则仍未认证；没有 key 或 marker 不表示没有样式影响。

## 有界执行片

- 单片最多 64 探针 / 30 秒，每组件最多 16 片 / 15 分钟；预留 3 秒，只在两个探针之间切换执行片。片满、变体切换或临近时间上限时重建四个独立浏览器上下文，继续执行相同版本的 B/A-A/M 及差异复验。每次探针仍完整导航，不复用上一片的 Document、localStorage、强制状态或注册属性。
- 单个浏览器操作同时受当前片及整轮剩余时间约束。挂起 / 异常返回 ERROR，不自动重跑到绿色；正常耗尽片数或运行预算则保留未执行 ID 和 review。已经确认的差异不会被后续未执行项抹掉。
- `probe-shards.json` 保存受信预算、全量已入队探针、每片唯一分配 / 完成项、状态与耗时；每个采样结果含 `shardId`。条件覆盖只接纳真正采样且 A/A 稳定的证据，不把“已分配”当“已完成”。条件规划超出全局容量的需求仍在 `condition-plan.json` 中保留。
- 测试只允许缩小诊断预算；真实组件构建不接受预算覆盖。执行片共享同一控制进程的冻结构建 / 浏览器身份，不接纳外部片报告，也不提供正式门禁批准入口。整夹具超过 256 探针或 30 秒仍保留预算 review，不通过切片隐藏性能问题。
- 浏览器链路回归新增完整分片、片数不足、已确认差异后片数不足三种情况，并读取快照中的 localStorage 访问计数，独立检查跨片上下文确实重建。

## 采集性能与正确性保护

- 属性名发现仍枚举每个元素的普通样式及 `::before` / `::after` / `::marker` / `::placeholder`，包括尚未生成的伪元素。没有按变量前缀、是否命中规则或默认状态删属性。
- 每个声明对象只读一次 length，然后用 `item()` 取全部名称；浏览器内实验逐项确认名称与原始 for-of 相同。保留浏览器原始标准属性顺序，不排序后冒充相同快照。批量 descriptors 更慢、Typed OM 属性集合不完整，均未作为替代路径。
- 同一次页面执行中冻结动画到 0、发现完整属性并集、记录几何 / 原始 DOM 属性、采集逐节点自定义变量，再用 CDP 批量取标准属性。避免原来重复遍历 DOM、重复准备动画和单独传输变量的阶段。
- 准备数据只允许立即、单次用于 time-zero 采集；重用或改变时间明确报错。每次导航、宽度或状态变化都重新发现，不缓存跨探针的属性名或变量值。
- 自定义变量按具体 node key 合并，不按共享标准样式 ID 合并。保留原有逐节点落盘结构；不再将千余属性的完整样式 JSON 去重后立即展开。标准属性集合不一致时保留严格回退，无布局节点和协议缺失伪元素仍严格补采。
- `captureTiming` 与 `confirmationCaptureTiming` 是每次采集的控制端耗时，位于探针结果中，不进入产品快照 hash。准备阶段现包含动画 / 几何 / 变量工作；并行页面的耗时不能简单相加当作总墙钟时间。
- `capture-preparation.json` 保存 17 组浏览器准备 / 对照结果。参考路径独立使用原始枚举，不共享优化后的属性清单，避免两条路径同时漏属性。覆盖自定义变量、未生成与生成伪元素、marker、placeholder、隐藏节点、display:contents、SVG、动画、注册属性、尺寸 / 存在性变化、严格回退和一次性帧保护。
- 小规模性能诊断可只读使用之前的构建产物，但始终不是 PR 证据。正式实验仍走完整 B/M 源码隔离、依赖冻结、构建和采集流程，并逐探针核对旧快照与差异结果；A/A、独立差异确认、原有探针与覆盖缺口均不减少。

## 依赖恢复协议与限制

- 当前适配并认证 pnpm 12.4.1。其他版本在执行安装前拒绝，需要单独升级适配器和回归语料。
- 所有 manifest、workspace、overrides 和 patches 都绑定输入指纹。两侧输入相同则复用同一份临时解析锁；输入不同则分别恢复，不自动认定为纯样式迁移。
- 不接纳已有 `node_modules` 作为信任根。安装脚本、pnpm hooks、用户认证和运行时自动安装被禁用；使用固定控制端 Node，隔离的 pnpm 配置、缓存、临时目录和 copy 安装策略。
- 首次解析与获取只在显式 `--dependency-network` 下联网，随后用 `--offline --frozen-lockfile --frozen-store` 恢复并复核输入 / 锁。离线 cache miss 是 ERROR，不回退当前机器安装。
- 当前只接纳 registry semver、npm alias 和受支持的 workspace 范围；Git、URL、file/link、自定义 registry、可执行 config dependency 等进入错误 / 待扩展路径，不绕过检查。
- 原始内容指纹保留所有依赖文件及链接。可移植指纹只对 pnpm 的安装位置元数据和经过识别 / 目标校验的生成启动脚本进行路径归一化；逐项保留原始 hash。普通包文件中的绝对路径不归一化。
- 恢复模块已通过真实离线 pnpm 小工作区回归；用户随后明确授权了公开 npm 依赖查询 / 下载，真实 LiteTable 组件诊断链路也已跑通。不需要 npm 账号或 token，不发布包，不上传源码。
- 完整 workspace 模式仍拒绝 `packages/eval-dataset-parser` 的 `xlsx` CDN URL，不将其悄悄替换为 npm 版本。显式 `--fixture-dependencies` 使用经过检查的 host/compiler 入口及所选夹具的显式依赖并集；按各自源码 manifest 取版本，保留 overrides、解析策略和 patches。未使用的 patch 允许保留且记录 pnpm 警告，真正命中的 patch 仍照常应用。
- Capsule 不是生产工作区依赖闭包认证：删去无关 importer 可能改变 peer context，新增 / workspace 依赖也尚不自动适配。因此始终标记 `FIXTURE_CAPSULE_WORKSPACE_PEER_CONTEXT_UNPROVEN`、`gateEligible: false`；实际构建缺依赖就报错，不回退 checkout 的 `node_modules`。原始所有依赖输入仍绑定证据指纹，未映射的组件 / 样式仍留在覆盖清单中。
- 2026-10-30 首次完整真实样本（`run-ZbvBxY`，关闭 Provider 默认 CDN 加载之前）：两侧锁定 444 个包、41,633 个安装项，冻结恢复内容 hash 一致；构建加载 934 / 935 个模块。176 个探针全部执行，A/A 零不稳定，48 个差异探针独立确认；浏览器 56.4 秒，整轮 92.4 秒。结果为 FAIL，复现 wide 卡片布局 padding 6→8px、总高度 +16px、hover 背景及 min-width 差异。该样本还明确保留被拦截的 Provider CDN 样式表缺口，不能外推为整批 PR 验证完成。

当前不分析文档或测试变动是否 “必然无样式影响”。只有候选树完全没有差异才返回 4，避免把被运行时代码导入的资源错误排除。

## M1 尚未完成的部分

1. 将已跑通的组件 capsule 升级为经过证明的依赖闭包 / peer context，或补齐完整工作区的非 registry 来源适配；生产字体 / 资源也需本地锁定。
2. 14 个组件已有真实入口 adapter；继续扩大真实样本并补齐样式单元映射，不能用静态 HTML 语料或少量样本一致代替 PR 完整覆盖。
3. 完成已经起步的源码槽位 / CSSOM 条件映射：补齐旧模板静态规则、组合 class 的逐声明归属、原生 nesting 与复杂状态选择器，再补齐已接入调度的尺寸分区之影响闭包与全部逐绑定覆盖 key。现有正则实验 planner 仍仅用于语料，不作为正式 PR 覆盖证明。
4. 将现有混合采集、A/A 和差异确认扩展到完整条件、资源和 toolchain 身份，产生完整 `VerificationResult`。当前 gate reducer 只接受进程内输入，没有对不可信产物提供批准入口。
5. 之后才进入 M2：固定 Linux、可信发布、stale 校验，以及真实迁移 PR 的完整闭环。

在这些缺口关闭前，真实变更不能获得 gate PASS；已确认差异为 FAIL，证据不足为 NEEDS_REVIEW，执行失败为 ERROR。不能把 `self-test` 的绿色结果用于合入迁移 PR。批次、AI feedback、assisted PASS、required check 和自动合并均未启用。

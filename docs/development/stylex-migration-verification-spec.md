# StyleX 组件样式迁移验证 Spec

状态：目标设计与 M1 本地实现并存。已有 PR/SHA 准备入口、隔离构建、14 个真实组件 adapter、同版本对的批量诊断与有界条件采样；完整覆盖认证和 CI 合入门禁尚未完成。

本方案为 StyleX 及其配套 CSS Modules 迁移建立组件级样式验证 Infra。使用 Node.js 控制常驻 headless shell，从 CSS 规则生成条件探针，比较迁移前后的计算样式树、布局和动画语义。通过项不调用视觉 AI；差异项和不支持项进入有证据的反馈流程。

本文的 CLI、配置、schema、CI 检查名及目录默认描述目标接口，不代表均已落地。当前可运行命令与限制以 [`verification/README.md`](../../scripts/stylexMigration/verification/README.md) 为准；早期原型位于 [`scripts/stylexMigration/experiment/`](../../scripts/stylexMigration/experiment/)。现有诊断结果均为 `gateEligible: false`，不能直接放行 PR。

## 1 目标与关键决策

1. 对指定 PR 一键发现受影响组件、构建前后版本、生成探针、比较样式并输出合入结论。
2. 验证边界是组件及其明确声明的样式宿主，不引入登录、业务页面、后端链路或整页截图作为前置条件。
3. 保留真实组件的 DOM 和样式绑定。验证器不穷举业务 props，但必须覆盖本次变更涉及的样式变体和条件规则。
4. 默认使用 Node.js + Playwright headless shell + CSSOM + CDP/JS 混合采集。严格 JS 采集作为兼容回退和一致性校验。
5. 以实际源码为基准，不通过更新期望快照接受差异，不把 AST 或 CSS 文本 hash 当作渲染等价证明。
6. 结果只有 `PASS`、`FAIL`、`NEEDS_REVIEW`、`ERROR`。零差异不自动等于通过，还必须满足覆盖、能力和稳定性条件。
7. 自动判定率目标为至少 95%；合入要求是样式变更处置完整率 100%。剩余 5% 不能当作已验证。
8. 首版检测器不执行 merge、push、rebase、retarget 或分支保护修改。启用 required check 和自动合并由维护者单独配置。

## 2 范围与非目标

### 2.1 本次范围

- Emotion/createStaticStyles、StyleX、CSS Modules 之间的纯样式迁移。
- DOM 节点和常见伪元素的已解析标准 CSS 属性、布局边界、滚动尺寸、文本及必要的渲染属性。
- 伪类、原生 CSS 嵌套、media/container/supports 条件、主题、方向及受支持的动画。
- PR 变更清单、样式来源映射、组件夹具、共享样式影响分析和覆盖证据。
- 本地 CLI、批次检测、CI 报告、严格失败判定和受信任的反馈批准记录。

### 2.2 不在本次范围

- 证明组件在任意业务数据、任意宿主页面或所有 props 组合下行为正确。
- 验证页面导航、接口、白屏、业务交互或服务端行为。
- 用每个组件的前后截图作为默认判定路径。
- 实现新的 CSS cascade/layout 引擎或浏览器 fork。
- 在单一浏览器结果上承诺跨浏览器、跨操作系统或逐像素等价。
- 验证 Canvas/WebGL 绘制内容、视频帧或 JS 事件处理器的业务语义。

图片、字体、SVG 等资源不作为黑箱忽略：若变更影响其内容、来源或渲染属性，必须纳入资源校验或转反馈，见第 10 节。

## 3 已有实验与当前缺口

### 3.1 实测基线

2026-10-30，本机 Apple M2 Max、macOS arm64、Node v24.15.0。依赖包括 React 19.2.7、@lobehub/ui 6.9.0、StyleX 0.19.1、Playwright 1.64.1、Vite 8.0.16。

| 项目                    | 实测结果                              | 解释                                           |
| ----------------------- | ------------------------------------- | ---------------------------------------------- |
| 真实源码样本            | 14 个组件、16 个夹具、304 个探针      | 来自 3 个迁移分支，不代表整批 PR               |
| 严格 JS 采集            | 48.38 秒                              | 含原始自定义属性诊断                           |
| shell 混合采集          | 8.86 秒                               | 同样 304 个探针，约 5.46 倍加速                |
| 完整 Chrome 混合采集    | 8.94 秒                               | 同一组件验证任务                               |
| 采集器直接对照          | 72 次，零不一致                       | 比较标准属性树，含两侧源码、容器边界、动画时刻 |
| 独立 before/before 对照 | 16 个夹具，零差异                     | 两个独立页面挂载同一版本                       |
| 33 个边界用例           | 28 个缺陷检出、4 个等价对照、1 个反馈 | 默认状态只检出 29 个缺陷中的 13 个             |
| 样本自动判定率          | 32/33，约 96.97%                      | 不是整批 PR 覆盖率或普遍检出率                 |
| 新进程启动中位数        | shell 77.62ms；Chrome 314.82ms        | 每引擎 3 次启动，不是冷机启动                  |
| 两页进程 RSS 合计中位数 | shell 577.88MiB；Chrome 1504.66MiB    | 可能重复计算共享页，不是独占内存或峰值         |

组件验证循环计时不含依赖安装、浏览器下载、源码导出、构建、浏览器启动和首次页面加载。包含构建、严格 / 混合对照、矩阵、复现和性能测量的完整实验步骤约 109 秒；不能用它估算所有 PR 的总耗时。

实验发现 `LiteTable` 的 800px 容器分支发生实际回归：在 601–800px 容器宽度下，部分单元格 `padding-block` 从 6px 变为 8px，示例两行总高增加 16px；`min-width` 和 hover 背景的层叠关系也发生变化。仅在实验页面注入修正后，7 个复现探针的渲染相关差异归零。真实组件和 PR 尚未因此修改。

本地证据在 `.records/stylex-migration-experiment/final/`，包括 `report.html`、`summary.json`、`reproduction.json`、`backend-parity.json`、`benchmark.json` 和 `provenance.json`。该目录被 Git 忽略，不能作为克隆仓库后必然存在的 CI 依赖；正式落地须提交精简基线及可复现语料，并通过 CI 保存完整产物。

### 3.2 原型不能直接作为合入门禁

| 原型现状                       | 正式要求                                         |
| ------------------------------ | ------------------------------------------------ |
| 组件、基线和 3 个来源分支写死  | 从指定 PR 解析完整变更与唯一版本对               |
| 部分引用回退到当前工作区源码   | 两侧分别解析完整版本依赖，禁止工作区污染         |
| 发现差异仍可退出 0             | 非通过结果必须阻止合入                           |
| 只为已挂载、已匹配规则生成探针 | 变更样式单元必须全部进入覆盖分母                 |
| 分支 marker 证明至少命中过一次 | 证明所需元素、条件分区和组合已覆盖               |
| 正则辅助选择器和断点发现       | 使用可测试的 AST / 规则 IR，不支持时明确反馈     |
| 组件样本通过，未有 PR 总体结论 | 缺失夹具、共享影响或未分类文件都阻止自动通过     |
| 本机 Chrome 路径和已安装依赖   | 可配置浏览器、固定 CI 镜像与可恢复依赖快照       |
| 重跑一次完整实验               | PR 增量验证、缓存、失效规则、批次 DAG 和 CI 门禁 |

## 4 验证契约

一次验证证明：在固定的源码、依赖、宿主、资源、浏览器和支持能力范围内，本次样式迁移没有产生未解释的样式或布局变化。它不是任意 CSS 的形式等价证明。

### 4.1 版本身份

每次运行至少固定：

```ts
interface VerificationIdentity {
  repository: string;
  prNumber?: number;
  pullRequests: Array<{ number: number; headSha: string; baseRef: string }>;
  trigger: 'pull_request' | 'merge_group' | 'local';
  baseSha: string; // 目标分支本次快照 B
  headSha: string; // 单 PR 为 H；merge_group 为组 head
  candidateTreeSha: string; // B 合入 H 的候选树 M
  baseDependencyHash: string;
  candidateDependencyHash: string;
  verifierHash: string;
  policyHash: string;
  registrationHash: string; // 可信迁移队列或显式本地请求的身份
  fixtureManifestHash: string;
  browserBinaryHash: string;
  browserVersion: string;
  runnerImageDigest: string;
  environmentHash: string; // 字体、DPR、locale、timezone 等
}
```

单 PR 的 headSha 为 H；merge_group 的 headSha 为平台给出的组 head，组内每个 PR 的 head 单独保留在 pullRequests。候选提交如可取得也一并记录；candidateTreeSha 始终指向实际被构建的树。

门禁比较 `B → M`，而不是把任意旧的 merge-base 与 head 比较后就视为当前目标分支可合入。`merge-base(B,H) → H` 可用于归因和解释，不替代最终候选验证。

任何身份字段变化都使已有批准和结论失效。局部缓存可以复用，但必须重新形成绑定新身份的总体报告。

### 4.2 样式变更单元

覆盖分母不能是 “当前页面匹配到的 CSS 规则数”。定义变更单元为：源码中的组件 / 样式导出 + 样式槽位或选择器 + 条件路径 + 声明集合。

- 同一规则内仅声明值改变，仍是一个需要比较的单元。
- 一个旧样式拆成多个原子类，允许一对多映射；映射必须有源码、构建映射和实际 DOM 绑定证据。
- 删除、增加、重命名、移动样式单元都必须登记，不能仅扫描 after。
- CSS Modules、全局 CSS、inline style、主题 token、keyframes、`@property`、`@font-face` 都进入清单。
- 不能映射、动态生成或未挂载的变更单元保留在分母，状态为 unresolved。
- 源码完全未变且传递依赖指纹未变的单元可以复用证据；“从未观察到” 不是排除理由。

### 4.3 覆盖与效率指标

```text
machineCoverage = 机器已完整判定的变更单元 / 全部变更单元
resolutionCoverage = 已机器判定或获有效补充证据批准的单元 / 全部变更单元
automaticDecisionRate = 无需 AI 或人工介入即给出确定结论的组件 / 本批应验证组件
```

确定发现差异也属于自动判定，但不属于通过。另报组件、样式单元、条件组合、探针数和资源覆盖率，禁止互换分母。

`PASS` 要求 `resolutionCoverage = 100%`，没有未处理差异、运行异常或不可豁免缺口。95% 是批次效率目标，不能作为单个 PR 的通过阈值。

## 5 一键 PR 工作流

```text
解析 PR 与固定 B H M
        ↓
分类变更与构建完整样式影响清单
        ↓
注册或生成夹具并隔离构建 B M
        ↓
两侧规则并集 → 条件计划 → 能力与覆盖检查
        ↓
独立 A/A → B/M 探针 → 混合采集与比较
        ↓
原始差异 → 受限等价规则 → 覆盖及稳定性检查
        ↓
PASS / FAIL / NEEDS_REVIEW / ERROR
        ↓
绑定版本的报告与受信任 CI 合入检查
```

### 5.1 输入解析

1. 通过 GitHub API 分页读取 PR 元数据和变更文件，确认 repository、base、head 和 fork 来源；分支名只作展示，不作身份。
2. 获取所需 Git 对象并固定 SHA。优先使用平台提供的候选合并提交；否则在独立快照工作区生成候选树，不操作用户工作分支。
3. 合并冲突、缺少对象、无法确认候选身份时停止，不能退回 “只检测 head”。
4. 读取可信策略和 fixture registry，生成不可变的运行 manifest。
5. 发布前再次读取最新身份；有更新则报告 stale，旧结果不能给新版本绿灯。

### 5.2 迁移范围与影响分析

CLI 显式指定 PR 即请求迁移验证；CI 的强制迁移范围来自受信任的 PR 队列或维护者登记策略，不从 PR 作者自填的标题 / 正文直接决定。登记后的 PR 不能通过删除标签或改写配置自行退出门禁。是否退出需要维护者的可审计操作。

普通功能 PR 的目标可能就是改变样式，不要求迁移等价；CI 路由应明确输出 `OUTSIDE_MIGRATION_SCOPE`，而不是把有意改变样式误报成迁移失败。该路由不声称没有样式变化，也不替代仓库原有检查。已登记迁移 PR 若发现混合业务变更，应拆分或由维护者重新确认范围，不能自行改为无关。

建立 TS/TSX import、样式 import、样式导出、主题 token、资源和构建配置的依赖图。入口包括直接变化的组件，以及被变化的共享样式、Provider、token 或资源影响的消费者。

- rename/delete 必须基于 Git 状态和两侧源码追踪，不依赖文件名后缀判断。
- 分类结果分为样式相关、明确无关和无法分类；无法分类不能视为无关。
- 组件 className、inline style 和样式槽位绑定属于样式范围，不能仅比较样式文件。
- 涉及业务逻辑、DOM 结构或依赖变化的混合 PR 可以运行样式检查，但不能仅凭此检查获得 “纯迁移可合入” 建议。
- 跨组件样式耦合必须纳入消费者或声明的 host contract；依赖图不完整时进入反馈。
- 只有可信分类器确认没有样式影响，或可信登记策略确认不属于迁移范围时，才走第 12.2 节的明确路由；不能把无法分类当作无关。

### 5.3 现有批次与堆叠分支

批次入口实时解析输入 PR，不硬编码历史 20/22 个 PR，也不遍历所有远程分支自行扩大范围。

批次规划输出依赖 DAG、每个 PR 的实际目标分支和阻塞原因。存在环或缺少父分支时阻止该节点。独立节点可以并行；子 PR 不能使用 “父 PR 尚未交付” 的结果证明已经适合另一个目标分支。

父 PR 合入、子 PR rebase 或 retarget 后，重新解析 B/H/M 并生成新结论。首版不自动修改 PR 目标、不自动叠加到 canary、不自动合并。最终交付到 canary 时，证据必须对应实际 canary 合并候选；在中间父分支通过不能自动继承为 canary 通过。

## 6 快照构建与依赖隔离

### 6.1 完整版本解析

base 和 candidate 分别使用自己的完整源码树和构建配置。`@/*`、workspace package、相对导入、CSS import、stylex token 及构建插件都从相应快照解析。

禁止只导出组件目录，再把缺失依赖静默指向当前 checkout。若为了性能使用 overlay，构建器必须记录每个模块的来源，证明 overlay 外所有模块在 B/M 完全相同；无法证明则使用完整快照。

路径解析和静态服务均限制在本次快照 / 构建根目录内，拒绝越界路径及逃逸 symlink。静态服务只暴露允许的构建资源，不提供任意仓库或宿主文件读取接口。

同一版本对必须使用相同的受控构建模式和 toolchain；如果 PR 本身修改了构建配置，应实际构建两侧配置并标记该变化，不能用统一配置掩盖差异。

### 6.2 实际依赖快照

仓库当前 `pnpm-workspace.yaml` 为 `lockfile: false`。正式验证不能假设存在可用的根锁文件，也不能仅比较 package.json。

纯样式迁移默认采用同一份固定的、可恢复的解析依赖快照：

- 覆盖 pnpm 版本、workspace 配置、overrides、patches、所有相关 package manifests，以及完整解析依赖图。
- 记录版本、peer variant 和可用的包内容完整性标识，产出 immutable dependency snapshot；`node_modules/.modules.yaml` 只能作为输入之一，不能独立承担完整性证明。
- 两侧依赖声明一致时，从同一快照安装或恢复，安装后再次校验指纹。
- 依赖声明不同则使用各自可恢复的快照，标记为 dependency delta；首版不自动认定该 PR 是纯样式迁移。
- 快照缺失、完整性无法验证或安装漂移时返回 `ERROR`，不得使用 “当前机器刚好安装的版本” 继续给绿灯。

依赖快照是隔离验证的产物和缓存协议，不要求本次修改全仓库的包管理策略。

依赖准备阶段在隔离的安装副本临时启用锁文件生成，保存可恢复的锁数据、包完整性和 workspace 输入 hash；不将临时锁文件写回用户工作区。后续运行使用该快照进行冻结恢复。首次解析的结果必须完成完整性校验后才能进入可信缓存，不能将某台机器未验证的 node_modules 打包后作为信任根。

### 6.3 运行环境

固定 Node LTS 版本、Playwright 与对应浏览器二进制、Linux runner 镜像、字体文件、DPR、locale、timezone、color scheme 和 reduced-motion。记录真实二进制版本，不只记录包版本。

默认 headless shell，完整 Chrome 用于能力回退和验证器回归测试。浏览器路径通过配置解析，不能写死 macOS 路径。不同引擎内分别比较 B/M，不能将 Chrome 的 B 与 shell 的 M 直接比较。

## 7 组件夹具与宿主契约

### 7.1 夹具来源

优先复用现有 story、组件演示或轻量测试 host。缺少时生成可评审的最小夹具，并注册到版本管理中的 registry；AI 生成的夹具不自动视为覆盖完成。

同一夹具定义分别加载 B/M 的真实组件，使用固定内容和必要 Provider。不得通过 stub 掉被迁移组件、手工重建 “看起来相同” 的 DOM 或只给人工 DOM 粘贴两份 CSS 来替代实际挂载。

夹具可以 stub 与样式无关的 API/store 数据，但须记录 adapter、Provider、资源和版本。若 adapter 改变布局、字体、样式导入或条件绑定，就不再是无关依赖。

### 7.2 声明格式

```ts
interface StyleFixture {
  id: string;
  component: {
    id: string;
    base: { source: string; exportName: string };
    candidate: { source: string; exportName: string };
  };
  render: string; // 同一夹具模块在两个快照编译
  host: string; // 外部祖先、容器、Provider 定义
  surfaces: Array<{
    id: string;
    selector: string;
    kind: 'component' | 'host' | 'portal';
  }>;
  styleVariants: Array<{
    id: string;
    setup?: string;
    expectedUnits: string[];
  }>;
  assets: string[];
}
```

接口名称为目标 schema；实际实现应使用严格 schema 校验并限制可执行 setup 的权限。

base/candidate 入口显式支持组件重命名和移动；两者仍必须映射到同一逻辑组件。找不到可比较的旧入口时报告映射缺口，不使用空组件充当前版本基准。

### 7.3 样式变体不是业务组合穷举

variant 只解决样式挂载，例如普通 /selected/disabled、生成中边框、表格 600/800px 模式。多个样式变体可在同一固定夹具中同时挂载。

若一个样式槽位在当前 DOM 中未被绑定，静态清单仍保留它。补充最小样式变体，或给出该槽位未变 / 不可达的可验证证据；不能因为不知道业务 props 就跳过，也不能仅靠强行添加生成类名掩盖真实 className 绑定丢失。

### 7.4 宿主与多个 surface

- 祖先选择器、命名 container、主题根、方向和外部 inherited values 必须在 host 中显式定义。
- 外部 host 和可变容器要进入探针定位范围，不限于组件根节点的后代。
- portal 必须注册自己的 surface；不属于任何 surface 的新增 DOM 或样式泄漏必须报告，不能自然消失在快照之外。
- Shadow DOM、自定义元素、iframe 等首版不能遍历的边界必须标记，不能只比较 host 外壳。
- host contract 是证据的一部分；不能声称覆盖未声明的任意页面上下文。

## 8 样式清单与条件 IR

### 8.1 两侧规则并集

从源码 / 构建来源映射和运行时 CSSOM 双向发现规则：静态清单保证不漏掉未挂载单元，CSSOM 提供浏览器实际接受的规则和嵌套结构。

每条规则保留来源、原始选择器 AST、声明顺序、`!important`、layer、scope、条件路径、keyframe/property/font-face 引用和匹配 surface。CSSNestedDeclarations 的相对位置不能丢失。

声明本身的变量、百分比、viewport/container 单位、`calc/min/max/clamp` 和环境依赖也属于 IR，不能只收集 at-rule 里的条件。

不能只用 `getMatchedStylesForNode` 发现规则：它不足以列出所有未生效分支。不能只扫描 before 或 after，否则新增 / 删除条件可能漏测。

公共 UI stylesheet 只有在源码、包版本和内容指纹均未变时才可标记为稳定背景；不能按 `lobe-*` layer 名称无条件排除本次变更。

### 8.2 选择器与定位

使用选择器 AST 定位伪类的实际触发元素，支持祖先、后代、兄弟、`:has()`、`:is()`、`:where()` 和受支持的 `:not()` 结构。解析失败必须返回 reason code，不用删除复杂部分后假定定位正确。

探针操作目标与最终样式目标是不同概念。例如 `.trigger:hover + .target` 强制的是 trigger；`.parent:has(.child:hover)` 强制的是 child。多个元素同时参与状态时，计划必须保留多个状态操作。

### 8.3 能力矩阵

| 能力                                                    | v1 处理方式                        | 自动通过条件                        |
| ------------------------------------------------------- | ---------------------------------- | ----------------------------------- |
| 普通声明、继承、变量消费、layer、important              | 浏览器真实 cascade，比较已解析值   | 变更单元和来源完整                  |
| 原生 nesting                                            | 保留 AST/CSSOM 嵌套路径与声明顺序  | 来源可映射，语料通过                |
| before/after/marker/placeholder                         | 显式采集，缺失时 JS 补采           | 存在性、内容和属性均覆盖            |
| hover/active/focus/focus-visible/focus-within           | CDP 强制状态                       | 每个所需触发位置和组合有证据        |
| px 宽度 media/container                                 | 分区采样、真实命中检查             | 所需区间、边界、交集已覆盖          |
| 命名 container                                          | 解析名称并找到有效查询容器         | 实际查询尺寸与计划一致              |
| 字面量 style query                                      | 对宿主设置命中值和非命中值         | 类型、继承及结果可验证              |
| color scheme、reduced-motion、direction                 | 受控环境探针                       | 实际媒体 / 方向条件已命中           |
| supports                                                | 当前能力探测，保留 inactive 分支   | 未覆盖变更分支不能自动通过          |
| CSS/WAAPI 动画与 transition                             | keyframes/timing、目标及时间采样   | 非支持 timeline/composition 转反馈  |
| checked/disabled/valid/open 等状态                      | 声明式样式 variant 或受控 DOM 状态 | 真实状态及绑定可观察，否则反馈      |
| visited、Highlight/selection、复杂 UA 伪元素            | 首版反馈，逐能力补适配器           | 不接受空快照作为等价                |
| scope、starting-style、scroll / 二维 / 复杂 style query | 首版反馈或经语料认证的扩展         | 不能仅因浏览器暴露 API 就宣称已支持 |
| Shadow DOM、adoptedStyleSheets、iframe                  | 首版反馈或专用 surface adapter     | 必须证明内部范围完整                |

能力按 “语法 + 条件 + 采集路径 + 用例” 登记，不按一个宽泛的 `supportsContainerQuery=true` 标志放行。浏览器原生支持某语法不等于验证器已经正确覆盖它。

## 9 探针规划与覆盖证据

### 9.1 条件分区

从两侧变更条件并集建立影响相关节点的分区，不对整个业务空间做笛卡尔积。

- 默认态、受影响的 light/dark、LTR/RTL、reduced-motion 条件纳入计划；没有改变且依赖完全稳定的环境维度可复用证据。
- 对尺寸条件保留边界与相邻可实现区间。整数断点可包含 `b-1/b/b+1`；相邻小数断点必须取区间内部点，不能只用 ±1px。
- `min/max`、严格 / 非严格比较、双边范围、`and/or/not` 应按解析后的逻辑规划。首版不能处理的单位或逻辑组合必须反馈。
- 容器探针针对实际查询的内容尺寸；处理 box-sizing、padding、border，记录测量值，不能把设置的 width 当作已命中的查询宽度。
- named container 找最近的有效命名祖先。style query 在正确宿主上改变值，不能改了目标节点就当作条件命中。
- media × container、media × hover、container × hover 等只要属于同一影响路径，就必须规划对应交集。
- `(hover:hover)`、pointer 等能力条件必须记录真实 `matchMedia` 结果；强制 hover 不会自动证明媒体条件也成立。
- 没有 media/container 规则的流式尺寸声明也需要依赖分析和相应尺寸探针。两个表达式在默认宽度碰巧相等，不能证明它们等价；不同的尺寸函数需要受限的表达式等价证明，或将结论限定到明确声明的离散宿主尺寸。既无法证明、也无法覆盖宿主契约时进入反馈。

### 9.2 状态操作与重置

```ts
interface StyleProbe {
  id: string;
  environment: {
    viewport?: { width: number; height: number };
    colorScheme?: 'light' | 'dark';
    reducedMotion?: 'reduce' | 'no-preference';
    direction?: 'ltr' | 'rtl';
  };
  operations: Array<
    | { kind: 'pseudo'; target: string; states: string[] }
    | { kind: 'containerSize'; target: string; inlineSize: number; blockSize?: number }
    | { kind: 'customProperty'; target: string; property: string; value: string }
  >;
  animationTimeMs?: number;
  requiredCoverageKeys: string[];
}
```

每个探针从固定初始状态开始。清除此前所有强制伪类、inline style、环境模拟、滚动、选择、焦点及相关动画状态。清理失败重建页面；不能继续在污染状态下采集。

CSS 强制状态用于 CSS 行为，不代表触发了 mouseenter、focus 事件或 JS 业务逻辑。确实依赖 JS 更新样式绑定的 adapter 必须显式声明其受控操作，不静默混用两种语义。

### 9.3 覆盖见证

覆盖 key 至少包含样式单元、必要的 DOM 绑定位置、条件分区及组合。只证明某条规则在某个节点命中过一次，不足以关闭所有 key。

支持使用不影响布局的私有 marker、匹配规则信息或其他受验证机制确认条件已激活。marker 必须隔离命名、及时清理并从产品快照排除；不得改变原始 cascade、资源或继承语义。

每个所需 key 要有 probe ID、实测环境、目标定位及生效证据。存在性条件需要正反样本，例如伪元素生成 / 消失；尺寸和条件交集要保留适用的命中与非命中分区。

禁止只按相同 className 合并多个元素的交互探针。只有证明其规则、条件和内容 / 布局影响等价的优化才能去重，且优化本身要有回归用例。

### 9.4 预算与终止

初始策略：每 fixture 最多 256 个探针、单 fixture 30 秒、单分片任务 15 分钟。它们是防止无界运行的上限，不是已经验证的性能 SLA。

超预算先尝试分片或缩小到有来源证明的相关组合。仍不完整则返回 `NEEDS_REVIEW/PROBE_BUDGET_EXCEEDED`，保存尚未覆盖的 key；不能截断后给 PASS。操作挂起或失去浏览器连接返回 `ERROR`。

M1 的本地诊断使用同一控制进程内的有界执行片：每片最多 64 个探针、30 秒；每组件最多 16 片、总计 15 分钟。每片重建浏览器上下文，继续复用同一次运行锁定的 B/M 构建和浏览器；记录探针到片的唯一分配、完成项、未执行项及实际耗时。接近片时间上限时只在探针之间换片，单个探针超时不自动重试；取消或异常保留已经确认的差异。

这是补齐诊断证据的执行机制，不是放宽上述正式 fixture 预算，也不是第 15 节的可信外部分片汇总。即使全部诊断片完成，整组件超过 256 探针或 30 秒仍保留预算 review；来源、依赖、资源等缺口也不因分片完成而关闭。后续正式门禁分片需要单独绑定完整任务计划及身份，并拒绝缺片、重复片、stale 或损坏结果。

## 10 样式树采集与确定性

### 10.1 混合采集

1. 固定动画时刻，收集真实 DOM、surface、文本、几何和动画元数据。
2. 通过 `DOMSnapshot.captureSnapshot` 批量采集浏览器支持的标准 computed properties。
3. 对 display:none、display:contents 等没有布局记录的节点，以及协议缺失的伪元素，用 JS 补采同一属性集合。
4. 使用严格 JS 路径按需读取自定义属性、诊断信息及当前协议无法可靠提供的数据。
5. 合并为统一 schema，再比较 B/M；不能因为节点没有 layout record 就丢掉该节点。

协议属性集合根据固定浏览器能力建立，并包含相关 SVG 等元素的属性并集。发现属性遗漏、不接受的字段或节点无法对应时，回退严格采集；回退也无法完整覆盖则反馈或错误，不返回空结果。

### 10.2 DOM 配对与资源

- 基于 surface、真实结构路径和可选稳定语义 key 配对；class hash、CSS Modules 名称和测试内部标记不作为产品属性比较。
- 节点缺失、增加、层级、顺序或标签变化是 `DOM_STRUCTURE_CHANGED`。首版纯迁移门禁不通过 “重新排序配对” 接受这些变化。
- 采集直接文本、伪元素 content、几何边界、client/scroll 尺寸，以及影响渲染的 SVG / 元素属性。
- 对伪元素显式比较存在性，不能把 `content:none` 与空内容生成盒混为一谈。
- asset URL 只能通过已校验的资源映射归一化：内容 hash、MIME、字体描述或必要元数据一致。不能简单删掉 before/after 路径或 query。
- 字体文件、font-face 描述、图片 / SVG 内容发生变化时，即使 computed 值相同，也不直接判定纯样式等价。

### 10.3 动画与 transition

保留 keyframe 顺序、属性、offset、easing、composite、timing、目标节点和伪元素。允许动画 hash 名变化，但只在完整效果语义一致时归一化。

CSS 动画固定采样初始点、受影响关键点和受控中间时刻，同时比较完整 keyframes/timing。transition 比较属性、时长、延迟、easing 和稳定端态，不仅比较结束画面。

不支持的 scroll/view timeline、无法取得的 effect 或无法确定的动画组合进入反馈。不能通过删除全部动画 CSS、强制 `animation:none` 或只看第一帧来获得通过。

### 10.4 就绪与稳定性

组件完成同步挂载、必要 effect、字体就绪和本地资源 decode 后才采集。等待有明确条件和超时，不用无限 rAF 或任意长 sleep 代替稳定性协议。

每个本次受影响夹具先运行独立 A/A 对照，允许按完整环境指纹复用近期控制结果。A/A 不稳定时返回 `NEEDS_REVIEW/UNSTABLE_FIXTURE`，不能增加容差直到变绿。

A/B 首次发现差异时，在重置后的独立状态确认一次。差异不稳定则保留两次证据并反馈；稳定差异为 FAIL。基础设施瞬时错误最多重试 1 次，保留首次错误；样式失败不自动重试直到通过。

## 11 比较规则与可解释等价

标准计算属性默认按相同引擎输出精确比较。几何初始容差为 0.05 CSS px；它不扩展到颜色、字号、padding、border、transform 等属性值，也不能由 PR 修改。

允许的归一化仅包括：

- 经过实际内容映射验证的资源位置变化。
- 具有完整语义映射的动画名和内部生成标识变化。
- 固定、版本化策略中的上下文等价规则。

初始可解释诊断：

| 诊断                    | 必须同时满足的条件                                      | 不能使用的情况                                     |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| 旧 `-webkit-box-*` 差异 | 两侧当前 display 均不使用该布局；消费者与能力已确认     | 任一侧使用旧布局或相关条件未覆盖                   |
| 不绘制的边框颜色        | 对应边两侧 width=0、style=none/hidden；相关状态已覆盖   | 边框存在、状态切换后绘制或来源不明                 |
| 私有自定义属性差异      | 来源与私有范围明确，所有相关消费者及 style query 已覆盖 | 公共 token、继承契约变化、未知消费者或注册语义改变 |

诊断保留原始值、前置条件、规则 ID 和生效 probe。`diagnostics-only` 是报告分类，不是第五种自动放行状态；只有其他门禁条件均成立，才能汇总为 PASS。

禁止全局忽略 vendor 前缀、自定义变量、border-color、所有颜色或数值差异。禁止让 AI 为单次失败生成无上下文的 ignore list。等价策略修改需要独立评审和正反回归测试。

## 12 判定与退出码

### 12.1 机器结果

| 状态           | 条件                                       | `verify` 退出码 | CI 处理                |
| -------------- | ------------------------------------------ | --------------- | ---------------------- |
| `PASS`         | 覆盖完整、能力明确、稳定，无未解释差异     | 0               | 允许样式门禁通过       |
| `FAIL`         | 稳定的样式、布局、结构或资源差异           | 1               | 阻止合入，定位和修复   |
| `NEEDS_REVIEW` | 覆盖缺口、不支持能力或不稳定               | 2               | 阻止自动通过，进入反馈 |
| `ERROR`        | 构建 / 安装 / 执行 / 协议 / 身份等运行错误 | 3               | 阻止合入，修复运行问题 |

同一次运行中，优先汇总 `ERROR > FAIL > NEEDS_REVIEW > PASS`，同时保留所有已发现 FAIL 和缺口，不让异常覆盖掉先前证据。取消任务没有可复用的通过结果。

适用范围非空但 fixture 数、树节点、对比次数或有效覆盖集合为空时，必须是 ERROR 或 NEEDS_REVIEW，绝不以零差异返回 PASS。

### 12.2 路由与无适用变更

`NOT_APPLICABLE` 属于可信路由结果，不是样式等价结论。区分两种原因：

- `NO_STYLE_IMPACT`：清单证明没有相关变更及传递影响；`verify` 返回专用退出码 4，并输出分类证据。
- `OUTSIDE_MIGRATION_SCOPE`：可信队列 / 策略确认普通功能 PR 不属于迁移门禁范围；由 CI 路由器输出，不伪造一次 verifier PASS，也不声称该 PR 没有样式变化。

CI 包装器只接受有合法 schema、正确身份和完整无关分类证据的退出码 4，发布明确的 “无样式影响” 成功检查。不能简单把所有非零码、skipped、neutral 或空报告转换为成功。

普通功能 PR 可得到明确的 “不适用迁移等价门禁” 成功检查，但必须附可信范围证据；登记状态不明则不能走此分支。迁移队列、登记身份和路由策略也纳入 gate 身份与失效校验。

### 12.3 最终合入建议

自动合入建议要求：

```text
pureStyleMigration
AND 当前 B/H/M 的有效 PASS
AND resolutionCoverage = 100%
AND 无未处理的真实差异或执行异常
AND 仓库其他 required checks 和 review 要求满足
```

混合业务 PR 的样式局部 PASS 只证明样式部分满足契约，必须标记 `gateEligible=false`，不替代其代码评审与其他检查。对覆盖完整的纯样式迁移，不再要求逐组件截图验证。

## 13 报告与可追溯数据

### 13.1 顶层结果

```ts
interface VerificationResult {
  schemaVersion: 1;
  identity: VerificationIdentity;
  stage: 'machine' | 'gate';
  decisionMode: 'automatic' | 'assisted';
  gateEligible: boolean;
  machineResultRef?: string; // assisted gate 必须引用原始机器结果
  reviewApprovalRefs: string[]; // automatic 结果为空
  status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW' | 'ERROR';
  pureStyleMigration: boolean;
  scopeHash: string;
  coverage: {
    totalUnits: number;
    machineResolvedUnits: number;
    reviewResolvedUnits: number;
    unresolvedUnitIds: string[];
    requiredKeys: number;
    witnessedKeys: number;
    missingKeys: string[];
  };
  findings: Array<{
    id: string;
    reasonCode: string;
    componentId: string;
    unitIds: string[];
    fixtureId: string;
    probeIds: string[];
    nodeKey?: string;
    property?: string;
    before?: string;
    after?: string;
    evidenceRefs: string[];
  }>;
  diagnostics: Array<{ ruleId: string; findingId: string; evidenceRefs: string[] }>;
  metrics: Record<string, number>;
  artifactManifest: Array<{ path: string; sha256: string; bytes: number }>;
}

interface RoutingResult {
  schemaVersion: 1;
  status: 'NOT_APPLICABLE';
  reasonCode: 'NO_STYLE_IMPACT' | 'OUTSIDE_MIGRATION_SCOPE';
  identity: Pick<
    VerificationIdentity,
    'repository' | 'baseSha' | 'headSha' | 'policyHash' | 'registrationHash'
  >;
  candidateTreeSha?: string;
  classificationEvidenceRefs: string[];
  registrationEvidenceRefs: string[];
}

type RunResult = VerificationResult | RoutingResult;
```

路由结果不带虚构的浏览器 / 依赖采样身份；`NO_STYLE_IMPACT` 仍须绑定实际分析过的 candidateTreeSha。机器结果与 assisted gate 结果分别保存，后者引用前者及批准记录，不覆盖原始产物。

每个变更文件和样式单元都要能追溯到 scope inventory 中的状态。报告须区分原始差异条次、归并后的 finding 和组件数量，不把逻辑 / 物理属性别名与多个探针重复计算成多个缺陷。

### 13.2 产物布局

```text
<run>/
  identity.json
  scope.json                 变更单元及消费者清单
  fixtures.json              夹具、surface、样式绑定
  capabilities.json
  probe-plan.json
  coverage.json
  result.json
  report.html
  timings.json
  snapshots/                去重、压缩的树与动画数据
  findings/                 最小差异和来源位置
  feedback/                 可选的 AI 反馈及受信任批准引用
  artifacts.json            hash、大小与保留信息
```

CLI 输出简洁摘要；HTML 提供条件、节点和属性下钻。默认不产生截图；需要视觉辅助时仅采集失败或不支持项的局部前后证据，并标记其条件和版本。

组件文本、路径和源码片段按数据转义，不能插入可执行 HTML、脚本或未转义的评论指令。报告使用静态内容；解析和解压产物前检查路径、字节数、节点数及嵌套深度上限，拒绝越界、异常膨胀和 schema 不符的输入。

策略、清单或 schema 校验失败不允许发布通过。必要产物超过上限时可以拆分和压缩，但不能丢掉未覆盖项；完整采样受资源上限限制时按实际缺口反馈。

## 14 AI 反馈与人工批准

### 14.1 AI 输入与权限

只对 FAIL 或 NEEDS_REVIEW 生成反馈包：版本身份、组件、样式来源、最小 DOM 路径、条件、属性前后值、未覆盖原因及必要的局部图片。通过项不调用视觉 AI。

AI 可以定位规则顺序、建议组件修复、生成 fixture/probe adapter、解释诊断或建议补充验证。输出必须引用具体 finding 和证据，区分 “解释” 与 “已验证修复”。

默认不自动调用付费模型。反馈入口显式启用并设置最大组件数、token 和成本预算；超限保留 NEEDS_REVIEW，不自动扩大执行范围。

组件文本、源码注释、产物和 PR 描述均为输入数据，不是指令。反馈代理没有合并权限、发布凭据或策略批准权限，不得按其中指令执行工具或改写 baseline。

### 14.2 反馈的闭环

优先通过补齐 fixture / 能力或修复迁移后重新检测，得到机器 PASS。AI 不能自行把 FAIL/NEEDS_REVIEW 改成 PASS，不能签署自己的补充证据。

对有限的不支持能力，可使用维护者批准的补充证据，条件如下：

- 仅接受可信策略列明的可审查 reason code，并绑定准确 unit、finding、条件和完整 identity。
- 记录批准人、证据 hash、结论、时间和有效期；批准者身份由 GitHub 权限 / 可信维护者策略确认，不能读取 PR 自填的 approvedBy 当作授权。
- 原始机器结果保持不变；单独的可信 gate 汇总补充证据，并把最终 PASS 标为 `assisted`，不计入 automaticDecisionRate。
- 任一 SHA、依赖、夹具、策略或环境变化使批准失效；批准只覆盖列明的 finding，不能通配整个组件或整个 PR。
- 实际渲染差异、构建失败、空覆盖、未知版本、未分类影响范围和预算截断不能靠批准 “忽略”。必须修复、拆分或补全检测。

首版若未实现并审计该受信任批准通道，只能提供 AI 建议，不能启用 assisted PASS。维护者在平台上绕过门禁属于显式例外，不得记录成检测器验证通过。

## 15 CI 安全与合入集成

### 15.1 执行面与控制面隔离

PR 组件、依赖安装脚本和夹具按不可信代码处理。运行在临时隔离环境中，不携带生产配置、发布 token、云凭据、SSH agent 或用户浏览器 profile。

控制面使用已评审、固定 hash 的 verifier、策略和 CI 脚本。PR 可以提交 fixture 和组件变更，但不能通过修改本次运行的检查器、覆盖清单、容差或批准策略改变门禁。Infra 自身变更需要专门的语料与策略评审。

浏览器只访问本次本地静态资源服务，外部字体 / 图片 / 接口请求被拒绝并记录；必要资源缺失必须反馈或错误，不能在不知情的 fallback 下判定成功。操作系统级执行环境同样限制网络及挂载范围，不能只依赖浏览器拦截保护安装 / 构建脚本。

可信依赖获取阶段只访问白名单包源并校验内容；如需私有源凭据，由独立获取阶段使用最小只读权限。执行 PR 安装脚本、构建插件和组件的环境不继承这些凭据，优先离线使用已校验的包缓存。组件运行环境不得写入 verifier、策略、宿主控制进程或受信任缓存。

### 15.2 Workflow 与发布

- 新建独立 `stylex-verification.yml`，不复用现有 `pr-admission-check.yml` 的高权限执行模型；后者当前仅读取 base 脚本和 PR 文本。
- 使用 `pull_request` 执行隔离验证；保留显式 `workflow_dispatch` 进行批次或人工重跑。若启用 merge queue，必须处理 `merge_group` 的实际合并候选。
- 不在带写权限或 secrets 的 `pull_request_target` 中 checkout / 安装 / 执行 PR 代码。
- 执行 job 使用最小只读权限，不持有评论 / 合并凭据。fork 运行使用同样的安全边界。
- 需要写评论或检查结论时，由单独的可信发布器校验 workflow run、repository、PR、SHA、attempt、artifact schema/hash 和最新身份后发布；不执行产物中的代码。
- 临时构建环境不能直接访问受信任结果缓存。发布器只接受关联到正确运行来源的结果，不信任 PR 预先放入的同名 JSON 或批准文件。

首版使用受保护默认分支上的独立发布 workflow（例如 workflow_run）形成最终检查。发布器必须从 GitHub 的实际运行来源和源码复核执行 workflow、其引用的本地 action/reusable workflow 及 verifier/policy 内容是否属于受信任版本，不能只相信 artifact 自报的 hash。当前 PR 改变控制面时，迁移路径不能为该变更自签 PASS；应先通过独立 Infra 发布流程更新可信版本。

启用 required check 前确认可信发布入口已部署到平台要求的默认分支。默认分支与 canary 等验证目标不一致时，控制面的发布要单独安排；不能只把实现合入某个迁移父分支，就假设发布 workflow 已可用。

发布 workflow 不执行 PR checkout、安装脚本或产物中的代码，不只在上游 success 时处理结果。上游失败、取消或产物缺失也要形成非通过结论。required check 绑定预期发布来源；仅创建同名 job 或上传同名 JSON 不能满足门禁。

验证器面向误迁移检测，不提供对恶意组件伪造一切观察结果的形式安全证明；代码评审和控制面隔离仍然必需。

### 15.3 Required check

唯一最终检查名为 `Style Migration Gate`；准备、分片、AI 反馈等辅助 job 不能使用同名检查。

最终 gate 始终运行并汇总分片，不用 workflow 级 paths filter 把需要的检查留在 pending，也不把失败 / 缺失分片视为 skipped 成功。无样式影响按第 12.2 节显式报告。

PR 更新时取消旧运行，旧 run 不得覆盖新 SHA 的状态。base 更新或进入 merge queue 时对新的候选重新形成结论。GitHub 必须要求候选与当前目标兼容；不能仅凭附在旧 head 上的绿色状态接受后来变化的 base。

启用合入门禁时，必须同时配置严格的分支最新性要求或 merge queue。若平台配置不能保证最终合入版本就是被验证的候选，检测结果只能提供 advisory，不能给自动合入建议。

启用 required check、review 规则或 auto-merge 需要维护者配置；落地 PR 不擅自改变仓库策略。其他 lint/type/test、代码评审和分支要求保持独立。

## 16 性能 缓存与运行资源

### 16.1 执行方式

默认一个常驻 shell、最多两组并发 B/M 页面；fixture 之间复用浏览器进程并隔离状态。按依赖影响范围增量构建和检测，不对每个 PR 重跑全部性能实验。

严格 / 混合树一致性、完整 Chrome 对照和缺陷注入语料在 verifier / 策略 / 浏览器升级时强制运行；普通迁移 PR 默认走已认证的快速路径，必要时回退。

每次记录源码解析、依赖恢复、构建、首次加载、计划、采集、比较、反馈及总耗时。API 调用耗时、warm loop 和端到端成本分别报告，不能用原始 DOMSnapshot 调用时间冒充完整检测时间。

### 16.2 缓存身份

构建 / 采样缓存至少绑定相关源码及传递依赖、构建配置、fixture/host、资源、环境、浏览器、verifier 和 policy hash。失去完整依赖图时禁用局部采样复用。

head/base 更新后的相同内容可复用内部缓存，但总体 identity、覆盖清单和 gate 必须重算。原始 FAIL 和 NEEDS_REVIEW 可以缓存用于诊断，不能作为 PASS 输入。

fork/untrusted job 不能向可信命名空间写入可被后续门禁直接信任的缓存。缓存命中后须验证内容 hash 和来源，不能仅凭 key 存在就接受。

### 16.3 上限与保留

初始每分片资源上限由固定 CI runner 配置，超过内存或时间上限按 ERROR 处理，不降级为少比较属性。清理仅针对本次创建且已验证路径的快照目录、profile 和进程，保留必要报告。

CI 标准产物初始保留 30 天；受限反馈证据和批准记录的保留期至少覆盖 PR 有效期。身份和关键判定摘要持久保存，不能依赖本地 `.records/` 或过期 artifact 作为唯一合入依据。

## 17 CLI 与配置

目标命令：

```bash
# 指定 PR，默认只读解析和本地检测
bun run stylex:verify --pr 21447

# 已固定源码对；用于本地或 CI 调用
bun run stylex:verify --base <base-sha> --head <head-sha>

# 仅生成清单和缺口，不签发 PASS
bun run stylex:verify --pr 21447 --plan-only

# 读取明确的 PR 列表，先输出依赖 DAG，再检测当前合法版本对
bun run stylex:verify batch --prs ./prs.json

# 显式请求受预算限制的反馈；不批准、不合并
bun run stylex:verify feedback --run <run-id> --max-components 5

# 验证器开发与浏览器升级使用，不是普通 PR 的必跑性能任务
bun run stylex:verify self-test
bun run stylex:verify benchmark
```

新增 script 只负责编译 / 启动 Node CLI；浏览器控制进程使用 Node。不会把整个实验 `run.ts` 当作每个 PR 的正式验证命令。

配置按权限分层：

| 配置                                 | 来源                               | 可否由当前迁移 PR 自行放宽         |
| ------------------------------------ | ---------------------------------- | ---------------------------------- |
| 浏览器、schema、等价规则、容差、预算 | 可信 Infra 版本                    | 否                                 |
| scope / 依赖身份                     | 可信解析器生成                     | 否                                 |
| fixture、host、样式变体              | 仓库 registry，经覆盖检查和 review | 可新增，不能隐藏变更单元           |
| 本地 output、并发上限、browser 路径  | CLI                                | 可以，身份必须记录；不改变通过标准 |
| 反馈批准                             | 可信维护者通道                     | 否                                 |

`--plan-only`、`--fixture`、调试属性子集等局部模式只能生成局部报告，明确 `gateEligible=false`，不得用于发布完整 PR 通过结论。发布操作需要独立显式开关和权限，默认不写 GitHub。

## 18 实现边界与目录

首版沿用现有迁移工具归属，不新建共享包或服务器服务：

```text
scripts/stylexMigration/
  experiment/                   保留实验与原始语料来源
  verification/
    cli.ts
    revisionResolver.ts
    scopeInventory.ts
    fixtureRegistry.ts
    buildSnapshots.ts
    ruleInventory.ts
    probePlanner.ts
    browserPool.ts
    capture.ts
    compareSnapshots.ts
    coverage.ts
    gate.ts
    feedback.ts
    report.ts
    types.ts
    fixtures/                   受版本管理的真实组件夹具和最小语料
    __tests__/                  跨模块与真实浏览器集成测试
.github/workflows/stylex-verification.yml
```

单模块单测与源文件相邻，跨模块 / 浏览器集成测试放 `__tests__/`。不为业务组件批量新增常规 React 单测；这套 Infra 的夹具和浏览器语料承担样式契约验证。

各模块不得绕过 `scopeInventory → coverage → gate` 直接将空差异标记为通过。共享类型只在有多个消费者时抽到 `types.ts`，文件仍遵守仓库大小限制。

## 19 测试与上线验收标准

### 19.1 判定器与安全测试

| 场景                                     | 必须验证的结果                                 |
| ---------------------------------------- | ---------------------------------------------- |
| 任意真实差异                             | 非零退出并阻止 gate，不只打印报告              |
| 变更非空但无 fixture / 无节点 / 无采样   | 不能 PASS                                      |
| 只覆盖部分样式单元                       | 保留缺口并 NEEDS_REVIEW                        |
| 规则从未匹配、删除条件或伪元素           | 仍进入覆盖分母并被检测                         |
| 私有变量等诊断                           | 前置条件成立才解释；绘制 / 消费者变化必须 FAIL |
| base/head/ 依赖 / 浏览器 / 策略更新      | 旧结论、批准不能复用为新 gate                  |
| 读取 fork 或错误仓库同号 PR              | 身份校验拒绝混淆                               |
| 后台 rAF、字体、浏览器或协议挂起         | 有界退出，不等待无限时长                       |
| 分片丢失、取消或 schema 损坏             | 总体不能绿灯                                   |
| PR 改动忽略规则、伪造结果或批准文件      | 不能改变可信策略或最终 gate                    |
| artifact 中 shell/Markdown/prompt 注入   | 只按数据处理，不执行、不扩权                   |
| 缓存污染、跨版本误命中                   | 完整性及来源校验拒绝                           |
| 无样式影响                               | 只有可信路由证据能 NOT_APPLICABLE              |
| 普通功能 PR 有意改变样式                 | 明确不适用迁移契约，不伪装成样式等价           |
| 已登记迁移 PR 自行删除标签或混入业务改动 | 不能自行退出门禁或继续得到纯迁移合入建议       |

### 19.2 浏览器语料

保留已有 33 个用例（含 4 个等价正对照），并增加：

- 小数窄区间、media/container 多轴与相互独立条件、实际内容宽度与 style width 不同。
- 没有查询条件的 `%/vw/cqw/calc/clamp` 迁移：默认宽度相同、其他宽度不同，不能默认放行。
- 多节点同时伪类、嵌套 `:has/:is/:not`、host 在组件根之外的状态触发。
- 无 layout 节点、placeholder/marker、伪元素出现 / 消失、多个 portal/surface。
- CSS layer 重排、嵌套声明顺序、shorthand reset、important、继承与 token 消费变化。
- 资源 URL 不同但内容一致、相同 URL 但内容改变、字体描述或 SVG 路径变化。
- 未挂载样式槽位、遗漏 className 绑定、被误排除的公共 UI layer、shared token 消费者遗漏。
- 动画 hash 改名正对照、delay/easing/composite/target 改变、缺失 timeline 能力。
- 页面状态未清理、前后环境不一致、协议补采遗漏和不同源样式读取失败。

缺陷注入针对能力与边界，不能仅堆叠普通颜色变更提高检出率。所有不支持项必须有明确反馈结果；不能把未实现项从语料分母删掉。

### 19.3 发布门槛

1. 受支持语料的预期差异全部检出，等价对照零误报；不支持项零误放行。
2. 混合 / 严格标准树在原有 72 次对照及新增语料一致；所有优化都有正反测试。
3. 真实 `LiteTable` 迁移在原始版本 FAIL，实际修复分支通过相同探针；仅实验 override 不算完成该项。
4. Linux 固定环境连续 20 次参考语料运行无不明波动；同环境混合路径相较严格路径至少 3 倍加速。绝对耗时基线和 runner 规格在该阶段锁定，不能沿用 macOS 数据充当 CI SLA。
5. 至少 3 个真实迁移 PR 完整走通清单、修复、重跑、发布和 stale 校验；其中每个 PR 的样式处置覆盖完整。
6. required check 的错误、反馈、无影响、取消、base 更新和 fork 路径均验证过；确认权限隔离与可信发布。

## 20 分阶段交付与迁移顺序

| 阶段              | 交付                                                     | 完成条件                                                       |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| M1 正式本地验证器 | 动态 PR/SHA 输入、隔离构建、scope/coverage、四态与退出码 | 未覆盖 / 失败 / 错误均不能绿灯，参考语料通过                   |
| M2 CI 与首批 PR   | 固定 Linux 运行环境、artifact、可信发布、首批完整夹具    | 3 个真实 PR 闭环，含 LiteTable 红绿回归；完成安全与 stale 测试 |
| M3 现有批次推广   | 批次 DAG、共享影响、夹具复用、增量缓存、AI 反馈          | 本批每个被放行 PR 独立满足合入契约                             |
| M4 常态迁移门禁   | required check、成本指标、能力升级流程                   | 维护者确认策略后启用；通过项不额外逐组件截图                   |

M1/M2 的 Infra 作为独立 PR 评审交付，不与大批样式迁移混在一起。LiteTable 的实际修复属于相应迁移 PR，不为实验数据变绿而修改历史基准。

已达到完整覆盖的 PR 可以先按正常评审合入，不需要等待全仓库达到 95%。扩大到至少 100 个真实组件并覆盖各类选择器 / 样式体系后，再报告分层的自动判定率、反馈原因、稳定性和成本，决定是否达到 ≥95% 的推广目标。

所有报告保持 “机器判定、AI 辅助、人工作为、实际合入” 四类事实分离。具备一键检测不等于已经授权一键合并。

## 21 维护与降级

verifier、策略、浏览器或依赖恢复协议升级需要重新跑认证语料和标准树一致性；版本号及 hash 变化使相关缓存和批准失效。

快速路径出现采集不一致时，可以对受影响能力切到严格路径，并记录实际 backend；不能删掉不一致属性来维持速度。严格路径也不可靠时保持 NEEDS_REVIEW/ERROR。

发生大面积误报时先保留原始数据、收敛明确的等价规则，再重新检测。不得自动批量忽略差异或复用升级前绿灯。维护者若临时关闭 required check，必须记录原因和范围；关闭门禁不等于相关 PR 已验证。

## 22 参考与证据入口

- 原型入口：[`experiment/run.ts`](../../scripts/stylexMigration/experiment/run.ts)；规则规划、严格采集、混合采集、分支见证和报告均在同目录。
- 固定实验基线：`stylex-foundation@5e17564fda9239ce3e936cae0fafa6026024c869`；组件样本版本与完整依赖指纹保存在实验 `provenance.json`。
- [CDP DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/)：批量 DOM/layout/computed-style 协议接口；支持细节以固定浏览器能力探测和语料为准。
- [CDP CSS](https://chromedevtools.github.io/devtools-protocol/tot/CSS/)：样式信息及强制伪类接口。
- [Playwright headless shell](https://playwright.dev/docs/browsers#chromium-headless-shell)：浏览器安装与运行方式。
- [GitHub workflow 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)：PR 与 merge_group 等触发机制。
- [GitHub Actions 安全参考](https://docs.github.com/en/actions/reference/security/secure-use)：不可信代码与权限边界。
- [GitHub required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)：仓库门禁配置；本文不代替维护者实际配置。

本 Spec 仅定义样式验证 Infra，不新增页面验收流程、线上发布操作或外部报告发布要求。

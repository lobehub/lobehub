# init.md — 项目接入（I-）

<!-- refs:meta
tier: flat
scope: 项目接入；AGENTS.md 探测、托管块、产品画像与组件盘点、自迭代规则
-->

> 05 stage 的依据。回答一件事：**这个项目里，lobe-design 的入口、项目层画像与自迭代规则写在哪、有没有写。**
> 指南文件是 `AGENTS.md`（放在仓库根目录）。它同时被 Claude Code、Cursor 等工具读取，所以只写一次。
> 项目事实落在 `.agents/ux/`（不进已安装的 skill 目录），重装 / 升级不会覆盖。

## I-01 探测顺序

按顺序找第一个存在的：

1. `<root>/AGENTS.md`
2. `<root>/CLAUDE.md`（已是 AGENTS.md 的项目很多是从这里迁移的）
3. `<root>/CONTRIBUTING.md`（不写进去，只作为「项目已有规矩」的输入；由人或 Agent 阅读，`bootstrap.mjs` 的 `CANDIDATES` 只含前两项，脚本不读它）
4. 都没有 → **建立** `<root>/AGENTS.md`

`AGENTS.md` 存在但托管块缺失时，**追加**托管块，不改动已有内容。
托管块之外的内容一个字都不动；这一条由 `scripts/bootstrap.mjs` 机械保证（它只做块级替换）。

## I-02 托管块（唯一会被 auto 改写的区域）

用注释标记界定，便于幂等更新：

```
<!-- lobe-design:begin · managed by scripts/bootstrap.mjs · 不要手动编辑本块 -->
...
<!-- lobe-design:end -->
```

块内包含五件事，缺一件就等于没接入（项目有 `.agents/ux/` 时另加项目层规范指针，见 I-06）：

| # | 内容 | 为什么必须有 |
| --- | --- | --- |
| 1 | **入口**：SKILL.md 的位置（`<root>/.agents/skills/lobe-design` 存在时默认指向它，否则指向全局安装），以及「先路由、再按 stage 加载」的顺序 | 没有入口，下一个人（或下一个 Agent）只能靠猜 |
| 2 | **触发**：哪些指令该进这条 pipeline；**装完 / 升级后先跑 05-init 两轮** | 决定宏观/中等/精细指令是否会被交给它；升级后不会忘了刷新项目层 |
| 3 | **纪律**：一次一个 stage、只加载白名单、`遗留 → <stage>`；**日常先读项目层**（`product.md` / `components.md`） | 这是注意力隔离的物理保证，不写下来就会被绕过 |
| 4 | **自迭代**：什么时候记一条经验、选层顺序、回写后跑什么 | 第 3 条需求；没有它，纠正只活在当次对话里 |
| 5 | **项目层指针**（有 `.agents/ux/` 时）：列出实际存在的文件 | 项目事实与 skill 通用判据分离，重装不丢 |

## I-03 自迭代规则（块内第 3 节的固定内容）

写进指南的是**判据**，不是口号。宿主项目和 skill 仓库各做各的：

- **何时记**：用户纠正了一次输出；80 审查发现同类问题本轮复发；60 或 lint 扫描发现可机械识别的漂移 ≥ 2 处。
- **在宿主项目里**：记进项目层规则文件（`.agents/ux/` 存在时是 `.agents/ux/lobe-design-rules.md`），续编号，删除的编号不复用。宿主项目不改已安装的 skill 文件，不 bump skill 版本，不写 skill 的 `learnings/LOG.md`。
- **选层（由强到弱，选当前可行的最强一层）**：`structure > lint > rule > style`。
  - 能用「出现了 X」「做了 X 却没有 Y」描述 → **lint**
  - 能用数数描述（档位 ≤ N、primary ≤ 1）→ **lint**
  - 需要看渲染结果但判据是数值 → **rule**，并标注「待浏览器脚本」
  - 只能主观判断 → **style**，必须写 `why_not_code`
  - 同一现象第二次出现必须升层（不能停在 style）。
- **通用经验**：去掉项目名之后还成立 → 按块内第 4 节走回流（`CONTRIBUTING.md`）。
- **回流落地后，在 skill 仓库里**：先写失败用例 → 再写反例 → 加规则（默认 WARN）→ 登记 reference → bump 版本 + CHANGELOG → 记账（`learnings/LOG.md`）→ `node tests/run.mjs` 全绿。lint 落地必须有真实规则 id 和回归样例；landed 必须带版本且 CHANGELOG 有该版本。
- **版本语义**：patch 修误报 · minor 加规则或 WARN 升 FAIL · major 改 stage 或路由、删除编号。删除的编号不复用。

完整流程在 skill 的 `learnings/README.md`；指南块里只放判据和那句「全绿才算完成」。

## I-04 幂等与校验

`node scripts/bootstrap.mjs`：

| 命令 | 行为 | 退出码 |
| --- | --- | --- |
| `node scripts/bootstrap.mjs` | 探测 → 建立或更新托管块（块外内容不动） | 0 |
| `node scripts/bootstrap.mjs --check` | 只检查，不写；块缺失或版本落后即失败；项目层缺失 / 过期打 WARN | 0 / 1 |
| `node scripts/bootstrap.mjs --print` | 打印将要写入的块，不落盘 | 0 |
| `node scripts/bootstrap.mjs --root <dir>` | 指定项目根目录（默认当前目录） | — |

`node scripts/project-scan.mjs`（只读，不落盘）：

| 命令 | 行为 | 退出码 |
| --- | --- | --- |
| `node scripts/project-scan.mjs` | 扫描框架 / 路由 / 组件目录 / README，输出事实 | 0 |
| `node scripts/project-scan.mjs --json` | 同上，JSON | 0 |
| `node scripts/project-scan.mjs --check` | 缺 `product.md` / `components.md` → 失败；指纹或 skill 版本过期 → WARN | 0 / 1 |
| `node scripts/project-scan.mjs --root <dir>` | 指定项目根 | — |

**写文件前先给用户看内容**（bootstrap 用 `--print`；项目层由 Agent 起草后确认），确认后再写。已有 `AGENTS.md` 时，报告「新增 / 替换了哪一块」，不报告整个文件。
**重跑 init 是更新不是追加**：`product.md` / `components.md` 整份替换对应章节，不复制粘贴第二份；文件头的 `<!-- lobe-design-init: version=… fingerprint=… -->` 同步刷新。

## I-05 边界

- 不改 `AGENTS.md` 里的既有段落，不重排、不格式化别人的内容。
- 项目已有自己的设计规范时，**不要覆盖**，让两者共存：`.agents/ux/` 下的规范由托管块自动指向（I-06）；放在别处的规范在块外手写一行指针。
- `bootstrap.mjs` **不写** `.agents/ux/` 下的内容（只探测是否存在）；`product.md` / `components.md` 由 05-init 的 Agent 两轮写入（I-07 / I-08）。
- **不改应用代码、不跑 build、不记录组件实现细节**——只写设计规则与用法指引。
- 不在没有写权限或用户没确认时落盘。
- **已安装的 skill 目录保持通用**：项目画像与组件盘点不写进 `$LOBE_DESIGN/`，重装 / `install.sh --copy` 不会冲掉项目层。

## I-06 项目层规范指针（`.agents/ux/`）

`<root>/.agents/ux/` 存在时，托管块在入口之后加一节「项目层规范」，按固定顺序列出其中**实际存在**的文件：`product.md`、`components.md`、`lobe-design-rules.md`、`cases.md`、`stack.md`、`audit/`，并写明：

1. **装完 / 升级后**先跑 05-init 两轮（缺或过期时）。
2. **日常任何 UI 任务**先读 `product.md`（含适用性）与 `components.md`，再进 stage。
3. 宏观指令和新页面从 `00-brief` 开始时，brief 引用 `product.md`。

- 只看文件是否存在，不读、不写它们的内容（内容由 I-07 / I-08 维护）；同一目录结构重复运行输出一致。
- 块外不必再手写同样的指针；项目特有的说明（例如某类页面先走另一个 skill）仍写在块外。
- `.agents/ux/` 不存在时不加这一节，自迭代里的规则文件写成「项目自己的规则文件」。

## I-07 第一轮：产品画像（Round 1）

装完或升级后，Agent **先**跑 `node scripts/project-scan.mjs --root <项目根>` 拿确定性事实，再结合 README / 路由 / i18n / 已有文档，判断并写入 `.agents/ux/product.md`：

| 字段 | 写什么 |
| --- | --- |
| 平台 | `web` / `desktop` / `mobile` / `mix`（可多选，说明主次） |
| 产品类型 | 消费级聊天、管理后台、开发者平台、评测/训练控制台、营销站、文档站… |
| 用户 | 角色、权限边界、使用频率 |
| 核心任务 | 3–7 条动词开头的主路径 |
| 适用性 | 哪些 P-xx 原型 / 规则**强调**、哪些**不适用**（例：触控为主 → hover-only 交互 N/A；高密度后台 → P-01 强调） |
| 文案 profile | 一行机读：`copy-profile: <consumer\|saas\|admin\|devtool>`，可按路由分区（`copy-profile: consumer; /admin → admin`）；再写人称（无主语 / 你 / 您）与术语表位置。75-copy 据此只加载一份 profile；判断不了时写 `copy-profile: 待确认` |

文件头必须带 init meta（供 `--check` 判过期）：

```
<!-- lobe-design-init: version=<skill版本> fingerprint=<project-scan 指纹> -->
```

只写事实与裁剪结论，不写实现、不改代码。重跑时整份更新该文件，不追加第二份。

## I-08 第二轮：组件盘点（Round 2）

在 Round 1 之后，扫描项目自己的组件目录（`src/components`、`features`、shared UI、对 lobe-ui 的包装等），写入 `.agents/ux/components.md`：

| 分类 | 判据 | 写法 |
| --- | --- | --- |
| 薄包装 | 几乎只是透传 lobe-ui | 标注「优先用上游件」，列出对应 lobe-ui 名 |
| 与 lobe-ui 重复 | 自建原子层（Button/Modal/Table…） | 标注「改用 lobe-ui」，不要扩写实现 |
| 业务组件 | 带领域语义、值得保留 | **场景 + 注意点**（何时用、何时不用、和别的件怎么配合）；**不写**内部实现、props 清单、源码路径细节 |

同样带 init meta；可顺手把项目层规则里与组件选型相关的强调写进 `lobe-design-rules.md`（续编号，不改 skill）。重跑更新，不重复追加。

## I-09 触发、升级与过期

| 时机 | 做什么 |
| --- | --- |
| 首次 `install.sh` / 拷贝安装之后 | install 输出提示跑 bootstrap + 对 Agent 说「初始化」；05 写托管块并完成两轮 |
| skill 升级之后（版本号变了） | 重跑 bootstrap（更新托管块）+ 重跑两轮（刷新 meta 里的 version） |
| 仓库结构大变（新框架、大目录搬迁） | `project-scan` 指纹变 → `--check` WARN → 重跑两轮 |
| 日常 UI 任务 | **不**重跑两轮；只**读**已有 `product.md` / `components.md` |

`bootstrap.mjs --check` 在托管块 OK 时仍会打印项目层缺失 / 过期的 WARN（不因此单独把已接入判成 FAIL）。
`project-scan.mjs --check`：缺文件 → exit 1；仅过期 → WARN + exit 0。

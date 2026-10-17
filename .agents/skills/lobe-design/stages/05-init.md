# Stage 05 · 项目接入与初始化（init）

> 只回答一个问题：**这个项目里，lobe-design 的入口、项目层画像（产品 + 组件）和自迭代规则写在哪、有没有写。**
> 只在 `bootstrap` 场景运行，或在用户明确要求「初始化 / 接入 / 建立指南 / 升级后刷新」时运行；**装完或升级 skill 后也应主动跑一遍**。
> 本 stage 的产出是：**AGENTS.md 托管块** + **`.agents/ux/product.md`** + **`.agents/ux/components.md`**（可选细化 `lobe-design-rules.md`）。不含任何界面改动。

新项目接入一次，后面每个会话都省一次解释。没接入时，每个新会话都要重新告诉 Agent「这是什么产品、用什么组件、有哪些纪律」，而且这些口径每次都会飘。

## 聚焦

- 探测指南文件：`AGENTS.md` → `CLAUDE.md` → 都没有就建立（见 [init.md](../references/init.md) I-01）
- 判断是「建立」还是「追加托管块」；已有内容一律保留
- 写入入口与顺序、触发条件、执行纪律、自迭代规则；托管块提醒「装完 / 升级后先跑两轮」（I-02）
- **Round 1 产品画像**：扫描仓库 → 写 `.agents/ux/product.md`（平台、产品类型、用户、核心任务、适用性、**文案 profile**）（I-07）
- **Round 2 组件盘点**：扫描项目组件 → 写 `.agents/ux/components.md`（薄包装 / 重复 / 业务组件用法）（I-08）
- 项目层落在 `.agents/ux/`，**不改**已安装 skill；重装不覆盖（I-05）
- 自迭代分两层：宿主项目记进项目层规则文件，通用经验回流后才在 skill 仓库里走版本 / CHANGELOG / LOG / 测试（I-03）
- 幂等：重跑更新，不追加重复块；`--check` 发现缺失或过期（I-04 / I-09）

## 不负责

- 不改任何界面 / 应用代码；不跑 build
- 不碰 `stages/` 与 `references/`（那是 skill 源码）
- 不记录组件内部实现、props 清单或源码路径细节
- 不重排、不格式化 `AGENTS.md` 里别人写的内容
- 不替项目决定技术栈选型本身；只描述 lobe-design 怎么被调用，以及本项目适用哪些规则

## 输入

- 00 brief（`project` 模式）：这是什么项目、谁在用、要沉淀什么（**必需**；本场景的 00 只出一行项目级简报）
- 项目根目录：`package.json` / 已有 `AGENTS.md` / `CLAUDE.md` / 是否有 `.agents/skills/lobe-design` 与 `.agents/ux/`
- `node scripts/project-scan.mjs --root <根>` 的确定性事实（框架、平台、路由、组件目录、README）
- skill 自身的版本号（写进托管块与 init meta，供 `--check` 比对）

## 只加载

- [init.md](../references/init.md)：I-01..I-09

## 步骤

### A. 接入 AGENTS.md

1. **先打印，后写入。** 跑 `node scripts/bootstrap.mjs --print --root <根>`，把将要写入的内容给用户看。
2. 报告探测结果：找到了哪个文件、是建立还是追加、托管块此前是否存在。
3. 用户确认后跑 `node scripts/bootstrap.mjs --root <根>`；已有文件时只报告「新增 / 替换了哪一块」。
4. 跑 `node scripts/bootstrap.mjs --check --root <根>` 确认托管块幂等。

### B. Round 1 · 产品画像

5. 跑 `node scripts/project-scan.mjs --root <根>`（或 `--json`）收集事实。
6. 结合 README、路由、i18n、已有 docs，判断平台 / 产品类型 / 用户 / 核心任务；据此定**文案 profile**（`consumer` / `saas` / `admin` / `devtool`，可按路由分区）与人称（无主语 / 你 / 您），写成一行 `copy-profile: …`（I-07）。
7. 对照 skill 的 P-xx 与关键规则，标出**强调**与**不适用**（适用性表）。
8. 起草 `.agents/ux/product.md`（文件头带 `<!-- lobe-design-init: version=… fingerprint=… -->`），给用户看后写入。已有文件则**整份更新**，不追加第二份。

### C. Round 2 · 组件盘点

9. 按 scan 给出的组件目录，把现有组件分成：薄包装、与 lobe-ui 重复、业务组件。
10. 起草 `.agents/ux/components.md`（同样带 init meta）：只写「哪个场景用哪个 + 注意点」。
11. 若有需要长期记住的选型强调，续写 `.agents/ux/lobe-design-rules.md`（不改 `$LOBE_DESIGN`）。
12. 跑 `node scripts/project-scan.mjs --check --root <根>`，确认文件齐全且指纹匹配。

### D. 收尾

13. 告诉用户：日常说需求即可；任何 UI 任务先读项目层再进 stage；升级 skill 后重跑本 stage。

## 检查清单

1. 探测顺序正确（`AGENTS.md` 优先于 `CLAUDE.md`）。
2. 写入前给用户看过内容，且得到确认。
3. **托管块之外的内容零改动**——这是硬保证。
4. 块内含入口、触发（含升级后重跑）、纪律（含先读项目层）、自迭代。
5. `product.md` 含平台、产品类型、用户、核心任务、适用性表、`copy-profile:` 行，且带 init meta。
6. `components.md` 三类分清，无实现细节，且带 init meta。
7. 未改应用代码、未跑 build。
8. `bootstrap.mjs --check` 与 `project-scan.mjs --check` 均通过（后者允许仅 WARN 过期已在本轮刷新后消失）。
9. 重复运行：托管块 `unchanged`；两份 ux 文件是更新而非重复章节。

## 输出

```
[05 · init] 完成
探测：<AGENTS.md | CLAUDE.md | 未找到 → 建立 AGENTS.md>
操作：<建立 | 追加托管块 | 替换托管块>　块外改动：无
Round 1：.agents/ux/product.md　平台=<…>　类型=<…>　文案 profile=<…>　适用性=<强调 N / N/A M>
Round 2：.agents/ux/components.md　薄包装=<n>　重复=<n>　业务=<n>
脚本：bootstrap --check → <OK/FAIL>；project-scan --check → <OK/FAIL/WARN>
遗留：<→ 00 / 80>
```

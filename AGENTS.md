# LobeHub Development Guidelines

Guidelines for using AI coding agents in this opensource LobeHub repository.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- SPA inside Next.js with `react-router-dom`
- `@lobehub/ui` for UI implementation (components plus `createStaticStyles` / `cssVar` for styles)
- react-i18next for i18n; zustand for state management
- SWR for data fetching; TRPC for type-safe backend
- Drizzle ORM with PostgreSQL; Vitest for testing

## Agent Skills

`AGENTS.md` owns repository-wide architecture and workflow. Keep detailed implementation rules in skills so they have one source of truth.

The `acceptance` skill is generated from the default branch of [lobehub/acceptance](https://github.com/lobehub/acceptance). Maintain its source there; update the committed `.agents/skills/acceptance/` copy using `bun apps/cli/src/index.ts acceptance update`. Repository-specific acceptance setup stays in `.agents/acceptance/`.

- **React and TSX**: Before editing components, component state, render boundaries, or memoization, read the `react` skill. It owns component selection, styling, state locality, and render-performance rules.
- **Heavy domain features**: When splitting a fat Viewer/Page into reusable pieces (page vs portal vs share vs micro-app), read the `compose-atoms` skill. Split on mountable capabilities, not visual sections, and do not hide unused work behind `readOnly` / `mode` flags.

## Code Ownership

For the full repository map or help locating a code layer, read the `project-overview` skill.

- `apps/server/src`: backend runtime, routers, and services, imported through `@/server/*`. `src/app/(backend)` contains Next.js route shells only; do not put backend business logic there.
- Server business code reaches Redis through domain methods in `apps/server/src/services/redis` (`redisService.deviceSystemInfo`, `skillTools`, `workspaceRescan`). The service aggregates domains and owns connections, keys, TTL and consistency policy. `apps/server/src/modules/Redis` is only the client/provider layer, not the business service. Add missing business methods to the service and missing transport primitives to the client. Generic cache/claim helpers stay internal to the service boundary. ESLint prevents new direct client access; its explicit legacy migration list only shrinks.
- `src/app`: Next.js HTML/auth shells. Web shell helpers belong under `src/libs` or the relevant app segment, not `src/server`.
- `src/spa`: SPA entry points and React Router configuration. `src/routes` holds thin page segments that compose `src/features`; business UI and logic belong in features by domain.
- `src/services` and `src/store`: client API services and Zustand state. Keep fetch/cache guidance in `data-fetching-architecture` and store conventions in `zustand`.
- `apps/desktop`, `apps/cli`: Electron and CLI applications. `packages` holds shared code, including `database`, `agent-runtime`, `env`, and `locales`.
- `e2e`: end-to-end tests using Cucumber and Playwright.

Before changing SPA routes, read the `spa-routes` skill. Register common Web/Electron paths, metadata, lazy loaders and `preloadId` values once in `src/spa/router/desktopRouter.shared.tsx`; keep `desktopRouter.config*.tsx` limited to platform differences and `desktopRouter.sync.test.tsx` passing. Do not create `features` directories inside `src/routes`.

## Development

### Starting the Dev Environment

```bash
# SPA dev mode (frontend only, proxies API to localhost:3010)
bun run dev:spa

# Full-stack dev (Next.js + Vite SPA concurrently)
bun run dev

# Standalone Hono backend service
pnpm --filter @lobechat/server dev
```

After `dev:spa` starts, the terminal prints a **Debug Proxy** URL:

```plaintext
Debug Proxy: https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=http%3A%2F%2Flocalhost%3A9876
```

Open this URL to develop locally against the production backend (app.lobehub.com). The proxy page loads your local Vite dev server's SPA into the online environment, enabling HMR with real server config.

This proxy is a **development convenience, not a verification surface**: it runs your local frontend against production's backend, origin, and data. Acceptance must exercise the delivered branch in an environment that runs it — for which surface to use, see `.agents/acceptance/PROJECT.md` §4.

### Git Workflow

- **Branch strategy**: `canary` is the development branch (cloud production); `main` is the release branch (periodically cherry-picks from canary)
- New branches should be created from `canary`; PRs should target `canary`
- Use rebase for `git pull`
- Commit messages: prefix with gitmoji
- Branch format: `<type>/<feature-name>`

### Package Management

- `pnpm` for dependency management
- `bun` to run npm scripts
- `bunx` for executable npm packages

### Quality Check

Use `bun run check [changed-files...]`.

- Every bug fix needs a regression test that fails before the fix and passes after it. Skip pure style/CSS fixes when the only practical assertion would match stylesheet source strings.
- Run once with the selectors needed: no selector means lint + related tests; `--lint`, `--test`, and `--type` compose. Default scope is all staged, unstaged and untracked changes; explicit paths override it.
- Lint autofixes files: review the emitted diff. Tests use the nearest owning Vitest config. `--type` checks the full repo (`bun run type-check`). Never run `bun run test`, which runs the full suite.
- `bun run type-check` runs Bun's builtin checker (`bun --check --tsconfig-override tsconfig.type-check.json`). That needs Bun ≥ 1.4.3. The package.json `check` script is the agent CLI (`bun run check`).
- `--alint` is opt-in: model-backed rules in `packages/alint/` for judgement calls eslint cannot express. It needs a provider (`bun run alint:setup`); findings are warnings to fix or justify in the PR.
- For a manual package test, run from the owning package: `cd packages/database && bunx vitest run --silent='passed-only' '[file-path]'`.

### Acceptance

Use the `acceptance` skill to decide whether the delivery needs product verification and whether existing evidence already covers it. Opening or marking a PR ready is a checkpoint for that decision, not a trigger to rerun verification.

- Documentation/instruction-only changes, pure refactors or tooling changes with no product behavior change, and gitlink-only syncs do not require a new acceptance run. State the reason in the PR; for a gitlink sync, link the upstream change and its existing acceptance when available.
- Changes to rendered UI text, including locale keys and translations, change product behavior and are not exempt. A test that only asserts key presence does not show that the page renders the text.
- Reuse a completed acceptance that covers the delivered behavior. If its report and evidence exist only locally, inspect and upload them with `lh acceptance run ingest`; if already published, reuse the link. Do not rerun the product merely to open a PR or obtain a report URL.
- For new or changed product behavior not covered by valid evidence, verify the affected outcomes on the real product, capture the required evidence, and publish the result. The skill owns reuse criteria and the execution workflow.
- Agent tool results shown in chat are Web UI outcomes even when the implementation is server-side. Verify the rendered tool card and parent reply, including the failure state when recovery is the goal.

When acceptance is required, put its published `https://app.lobehub.com/acceptance/<id>` link in the PR body. Tests, lint, and type-check remain separate quality gates; they do not replace product acceptance.

### i18n

- Add keys to a namespace file under `packages/locales/src/default/` (e.g. `agent.ts`, `auth.ts`)
- Ship en-US and zh-CN by hand in the same PR: author the English source in `packages/locales/src/default/*.ts`, mirror it to `locales/en-US/`, and hand-translate `locales/zh-CN/`.
- Leave all other locales to the daily CI workflow (`.github/workflows/auto-i18n.yml`), which runs `bun run i18n` and opens an automated translation PR. Missing locale keys fall back to English until that PR is merged.
- Run `bun run i18n` manually only when the translated locales are needed immediately instead of waiting for the daily workflow. It is slow and requires `OPENAI_API_KEY`; don't hand-translate the generated locales.

### Code Style

- Source and test files stay at or below 800 lines; a file already over the limit must not grow. Before adding, moving, or splitting files, read the `source-layout` skill for placement, naming, test location, and how a large file becomes a directory.

### Code Review

Before reviewing a PR / diff / branch change, read the **deep-review** skill. Ordinary review requests use its light mode (one independent reviewer against the dimension quick checklists); the full multi-subagent deep mode runs only on explicit invocation.

When designing or reviewing user-facing flows (empty/loading/error states, confirmations, async feedback, button hierarchy, lists at scale, pickers), follow LobeHub's design values — Natural / Meaningful / Certainty / Growth (自然 / 意义感 / 确定性 / 成长) — in the `ux` skill; [`DESIGN.md`](./DESIGN.md) covers visual tokens and voice.

<!-- lobe-design:begin · managed by scripts/bootstrap.mjs · 不要手动编辑本块 -->

## UI 设计工作指南（lobe-design）

本项目在做界面相关工作（新增页面、改交互、调视觉、统一设计系统、还原设计稿、上线前审查）时，
走 **lobe-design** 这条单入口 pipeline。安装：`https://github.com/lobehub/lobe-design-skill`（skill 版本 5.4.2）。

skill 装在本仓库的 `.agents/skills/lobe-design`，下面所有命令都相对它执行：

```bash
export LOBE_DESIGN="./.agents/skills/lobe-design"
# 改用全局安装时：export LOBE_DESIGN="${HOME}/.claude/skills/lobe-design"
```

### 项目层规范（`.agents/ux/`）

本项目的事实和补充规则放在 `.agents/ux/`，与 skill 共存：skill 管通用判据，这里管本项目；冲突时以 skill 为准。**重装 / 升级不会覆盖本目录。**

- `.agents/ux/product.md`：产品画像：平台、产品类型、用户、核心任务、规则适用性、文案 profile（05-init Round 1）
- `.agents/ux/components.md`：组件盘点：薄包装 / 与 lobe-ui 重复 / 业务组件用法（05-init Round 2）
- **装完或升级 skill 后**：跑 stage `05-init`（或说「初始化 / 升级后刷新」）完成两轮自迭代 ——Round 1 产品画像 → `.agents/ux/product.md`，Round 2 组件盘点 → `.agents/ux/components.md`。可用 `node "$LOBE_DESIGN/scripts/project-scan.mjs" --check` 检查是否缺失或过期。
- **日常任何 UI 任务**：先读 `.agents/ux/product.md` 与 `.agents/ux/components.md`，再按 stage 加载 skill 规则。
- 宏观指令（「整体打磨」「重做这页」）和新页面从 stage `00-brief` 开始：先读 `.agents/ux/product.md`，写出后续 stage 消费的页面简报；纯视觉或文案修正跳过。

### 1. 入口与顺序

- 唯一入口是 skill 的 `SKILL.md`。**先跑路由器，再按 stage 加载**：
  ```bash
  node "$LOBE_DESIGN/scripts/route.mjs" "<用户指令原文>"   # 场景 / 颗粒度 / stage 序列
  node "$LOBE_DESIGN/scripts/refs.mjs"  "<用户指令原文>"   # 每个 stage 该读哪些条目
  ```
- 路由器读取 `scripts/pipeline.json`（唯一事实源）。结果是默认值；结合上下文调整时要在输出里说明理由。
- **一次只进一个 stage。** 进入时才读它「只加载」列出的条目，不要一开始就把 references 读完。
- 每个 stage 只回答一个问题。看到别的问题，只记一行 `遗留 → <stage>`，不要顺手改。
- 改过代码的 stage，结束前跑 `node "$LOBE_DESIGN/scripts/lint-lobe.mjs" <改动路径>`，FAIL 必须修。
- **做界面前先读项目层**（若已有）：`.agents/ux/product.md`（画像与适用性）、`.agents/ux/components.md`（用哪个组件）；没有则先跑 05-init。

### 2. 什么时候用

| 触发                | 例子                                                        |
| ------------------- | ----------------------------------------------------------- |
| 新建界面            | 做一个控制台列表页、写一个官网落地页                        |
| 改已有界面          | 整体打磨一下、把层级理顺、把状态补齐                        |
| 统一设计系统        | 各页面风格不一致、token 收敛                                |
| 还原设计稿          | 照着这张截图做                                              |
| 上线前审查          | 能不能上线、验收一下                                        |
| 初始化 / 升级后刷新 | 把项目接上 lobe-design；升级 skill 后重跑产品画像与组件盘点 |

指令太抽象时（「体验不好」「丑」「难用」），先跑 `node "$LOBE_DESIGN/scripts/intent.mjs" "<原话>"`
把它归一化成「改哪里、看到什么算改好了」，再动手；归一化不了就先问，不要猜。

### 3. 自迭代：纠正要沉淀下来

- **何时记**：用户纠正了一次输出；80 审查发现同类问题本轮复发；60 或 lint 扫描发现可机械识别的漂移 ≥ 2 处。
- **在本项目里记**：写进 `.agents/ux/lobe-design-rules.md`，续编号，删除的编号不复用；新的产品事实写 `product.md`，组件用法写 `components.md`，一次性决定不记。
  不改 `$LOBE_DESIGN` 下的 skill 文件（重装会覆盖），也不在本项目里 bump skill 版本或写 skill 的 `learnings/LOG.md`。
- **选层（由强到弱，选当前可行的最强一层）**：`structure > lint > rule > style`
  - 能用「出现了 X」「做了 X 却没有 Y」或数数描述 → **lint**
  - 需要看渲染但要判据可写清 → **rule**（编号规则）
  - 只能主观判断 → **style**，且必须写 `why_not_code`
  - 同一现象第二次出现必须升层，不能停在 style。
- **通用经验走回流**：去掉项目名之后还成立 → 按第 4 节回流上游；不成立 → 留在项目层。
- **回流落地后（在 skill 仓库里，由维护者执行）**：先写失败用例 → 再写反例 → 加规则（默认 WARN）→ 登记 reference
  → bump 版本 + CHANGELOG → 记账（`learnings/LOG.md`）→ `node tests/run.mjs` 全绿才算完成。
  lint 落地必须有真实规则 id 和回归样例；landed 必须带版本且 CHANGELOG 有该版本。
- **版本语义**：patch 修误报・minor 加规则或 WARN 升 FAIL・major 改 stage 或路由、删除编号。删除的编号不复用。

### 4. 把经验回流到上游

通用经验（不依赖本项目品牌与业务）应该回流到 `https://github.com/lobehub/lobe-design-skill`，见其 `CONTRIBUTING.md`：

- 提之前先自检：去掉项目名之后还成立吗？场景是通用的还是本项目特有的？
- 本地先跑 `node "$LOBE_DESIGN/scripts/upstream.mjs" --from <你的 learnings/LOG.md>` 提取候选条目。
- 回流的是**判据**（可机械校验的规则、可复用的 stage 契约），不是本项目的具体取值。

> 本节由 `scripts/bootstrap.mjs` 维护。块外内容属于项目自己，不会被本脚本改写。
> 重新运行 `node "$LOBE_DESIGN/scripts/bootstrap.mjs"` 可把本块更新到最新版本。

<!-- lobe-design:end -->

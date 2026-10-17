---
name: source-layout
description: 'Use for where a file lives, how it is named, where its tests go, and how to split a source or test file over 800 lines (拆分大文件, 目录结构, 文件命名).'
user-invocable: false
---

# Source Layout

Top-level ownership (`src/features`, `src/routes`, `apps/server/src`, `packages`, …) is in `AGENTS.md` and `project-overview`. This skill owns placement and naming inside those roots, test placement, and how a large file becomes a directory. The rules record the conventions the codebase already follows; where it was split between two forms, the rule names the one to use for new files. Do not rename existing files only to match.

## 1. Names

| What                                                 | Form                  | Example                                        |
| ---------------------------------------------------- | --------------------- | ---------------------------------------------- |
| React component file / component directory           | PascalCase            | `PlanCard.tsx`, `ChatInput/ControlBar/`        |
| Hook                                                 | `useXxx.ts(x)`        | `ChatInputNotice/useChatInputNotice.ts`        |
| Other module                                         | camelCase or one word | `originLink.ts`, `recentDirs.ts`               |
| Server class module                                  | the class name        | `services/agentRuntime/CompletionLifecycle.ts` |
| Service, router, store, and other non-component dirs | camelCase             | `services/aiAgent/`, `store/chat/slices/`      |
| Package directory                                    | kebab-case            | `packages/agent-runtime/`                      |
| Files inside a package                               | camelCase             | `packages/database/src/models/`                |

A package whose files are already kebab-case (`alint`, `openapi`, `builtin-skills`) keeps kebab-case internally. Shared per-directory modules are `constants.ts`, `types.ts`, `style.ts`, and `utils.ts`, not `const.ts`, `type.ts`, `styles.ts`, or `helpers.ts`. Create one only when two or more modules in that directory use it; a constant or type used by one module stays in that module.

New files use named exports (`export const PlanCard = …`), even when the neighboring files default-export; do not copy the older default-export habit. The exceptions are modules a framework, tool, or loader imports by their default export: route segments under `src/routes` (see `spa-routes`), Next.js special files (`page.tsx`, `layout.tsx`, `not-found.tsx`), `*.config.ts` files, desktop controllers and services (`*Ctr.ts`, `*Srv.ts`, globbed by `apps/desktop/src/main/core/App.ts`), and locale resource files. Lint does not enforce this: this repository's `eslint.config.mjs` overrides `no-restricted-syntax`, which drops the shared `@lobehub/lint` warning on `export default`. When moving an existing file, keep its exports unchanged so its callers do not change.

## 2. Tests

One rule for every app and package:

- A test of one module sits beside it: `Foo.ts` → `Foo.test.ts`; a directory entry's test is `index.test.ts`.
- `__tests__/` holds only tests that do not belong to one module: integration tests that run several modules together or real infrastructure (database, Redis, the tRPC or Hono request stack), such as `routers/lambda/__tests__/integration/` and the database model and repository tests in `testing`, plus their shared setup, fixtures, and fakes.
- New tests follow this rule even in a directory whose existing unit tests sit in `__tests__/`. Move an existing unit test beside its module when you split or rewrite that test file; do not migrate tests as a side task.
- Split a large test file by scenario: `Foo.<scenario>.test.ts(x)`, keeping the original extension (`index.<scenario>.test.ts(x)` for a directory entry). Put shared mock factories and fixtures in a `testUtils.ts` beside them; each test file keeps its own `vi.mock` calls, because Vitest hoists them per file.
- Do not add React component tests, including to guard a split. Extract the logic into a hook or pure function and test that in `.test.ts` (`testing`).

## 3. File size

Source and test files stay at or below 800 lines. Generated code (`*.gen.ts`, `generated/` directories) and the `locales/default/` tables are exempt:

- A new file over 800 lines, or an existing file that crosses 800 lines in this change, is split in the same change. `bun run check`, the pre-commit hook, and the PR's File Size Gate job fail on both.
- A file already over 800 lines must not grow, including for a bug fix: the change may only keep or reduce its line count. Before adding code, extract the cohesive part the change touches. Put a new test in a scenario test file under the limit (§2), splitting the old test file first when the test belongs to one of its scenarios. Because hundreds of legacy files are over the limit, these checks report their growth as an advisory (a warning annotation in CI) instead of failing; it is still a required fix.

The limit says when to split, not where. Split on a real boundary (state, reuse, render update, sub-domain, pipeline stage), as `react` requires; never cut a file at an arbitrary line count. When a heavy feature is mounted by several hosts, use `compose-atoms` instead.

## 4. Turning a file into a directory

A split keeps the public import path: `Foo.tsx` becomes `Foo/index.tsx`, so `import Foo from './Foo'` keeps working and callers do not change. Commit the move (`mkdir -p Foo && git mv Foo.tsx Foo/index.tsx`) alone before extracting, so reviewers can read the extraction diff separately and Git keeps the rename while those commits stay intact (a squash merge folds them together). `split-large-file` has the full procedure.

| Kind            | `index` keeps                                   | Siblings                                                                                                                   | Precedent                                |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| React component | Public API, shared top-level state, composition | Child components (PascalCase), `useXxx.ts` for state transitions and side effects, pure logic modules with their own tests | `Conversation/Messages/GoalTaskCard/`    |
| Server service  | The class and its orchestration methods         | Stage functions taking an explicit `deps` object (`pipeline/<stage>.ts`), sub-domain folders                               | `services/aiAgent/`, `services/comfyui/` |
| tRPC router     | The merged router                               | One sub-router per sub-domain (`market/agent.ts` exports `agentRouter`)                                                    | `routers/lambda/market/`                 |
| Zustand store   | —                                               | Follow `zustand`                                                                                                           | `src/store/page`                         |

- Prefer flat siblings. Add a sub-folder for a sub-area with several files of its own (`ChatInput/ControlBar/`).
- Kind folders (`components/`, `hooks/`, `utils/`) follow who uses the code:
  - One user: keep it in that file or beside it (`PlanGrid/usePlanActions.ts`).
  - A few modules in the directory share it: flat siblings for hooks and components, one `utils.ts` for pure functions.
  - Three or more files of one kind shared by sibling modules: collect them in a kind folder (`Dashboard/utils/`, `ChatInput/hooks/`, `ResourceManager/components/`).
  - Shared across features: `src/utils`, `src/hooks`, `src/components`, or a `packages/*` package.
  - Do not create `helpers/`; name the module by its content or use `utils`.
- A split moves code without changing behavior. Collapsing duplicated branches that become one component is in scope when existing tests cover each branch; any other behavior change belongs in a separate commit.
- Move the matching tests with the code they cover, then run `bun run check` with the test files passed explicitly: related-test discovery finds only `<name>.test.*` and `<name>.<scenario>.test.*` of each changed file, so the entry's tests do not run for an extracted sibling such as `usePlanActions.ts`.

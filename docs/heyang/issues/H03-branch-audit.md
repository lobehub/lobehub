# H03 分支与工作区状态盘点

生成时间：2026-05-15\
当前仓库：`E:\heyu_project\lobehub`\
执行原则：本次只执行 git 只读命令，并新增本报告；没有 checkout、stash、reset、merge、commit、push。

## 1. 当前工作区状态

### `git status --short --untracked-files=all`

```text
 M docs/heyang/CHANGELOG-heyang.md
 M package.json
 M packages/business/heyang/src/kimi-compat.test.ts
?? .env.e2e.example
?? docs/heyang/LOCAL-DEV-SETUP.md
?? docs/heyang/TECH-DEBT.md
?? docs/heyang/TESTING.md
?? docs/heyang/TROUBLESHOOTING.md
?? docs/heyang/issues/F01-failed-to-get-session.md
?? e2e/heyang/README.md
?? e2e/heyang/features/kimi-compat/basic-chat.feature
?? e2e/heyang/features/kimi-compat/long-context.feature
?? e2e/heyang/features/kimi-compat/mcp-with-duplicates.feature
?? e2e/heyang/features/kimi-compat/structured-output.feature
?? e2e/heyang/features/kimi-compat/tool-call-roundtrip.feature
?? e2e/heyang/features/smoke.feature
?? e2e/heyang/fixtures/README.md
?? e2e/heyang/fixtures/kimi/agent-config.json
?? e2e/heyang/fixtures/kimi/duplicate-mcp-manifest.json
?? e2e/heyang/fixtures/kimi/normal-mcp-manifest.json
?? e2e/heyang/steps/kimi/basic.steps.ts
?? e2e/heyang/steps/kimi/client.ts
?? e2e/heyang/steps/kimi/structured.steps.ts
?? e2e/heyang/steps/kimi/tool.steps.ts
?? e2e/heyang/steps/smoke.steps.ts
?? e2e/heyang/support/hooks.ts
?? e2e/heyang/support/world.ts
?? scripts/heyang/preflight-check.sh
?? scripts/heyang/run-e2e.sh
```

### 已修改未提交文件

- `docs/heyang/CHANGELOG-heyang.md`
- `package.json`
- `packages/business/heyang/src/kimi-compat.test.ts`

### 未跟踪文件

- `.env.e2e.example`
- `docs/heyang/LOCAL-DEV-SETUP.md`
- `docs/heyang/TECH-DEBT.md`
- `docs/heyang/TESTING.md`
- `docs/heyang/TROUBLESHOOTING.md`
- `docs/heyang/issues/F01-failed-to-get-session.md`
- `e2e/heyang/README.md`
- `e2e/heyang/features/kimi-compat/basic-chat.feature`
- `e2e/heyang/features/kimi-compat/long-context.feature`
- `e2e/heyang/features/kimi-compat/mcp-with-duplicates.feature`
- `e2e/heyang/features/kimi-compat/structured-output.feature`
- `e2e/heyang/features/kimi-compat/tool-call-roundtrip.feature`
- `e2e/heyang/features/smoke.feature`
- `e2e/heyang/fixtures/README.md`
- `e2e/heyang/fixtures/kimi/agent-config.json`
- `e2e/heyang/fixtures/kimi/duplicate-mcp-manifest.json`
- `e2e/heyang/fixtures/kimi/normal-mcp-manifest.json`
- `e2e/heyang/steps/kimi/basic.steps.ts`
- `e2e/heyang/steps/kimi/client.ts`
- `e2e/heyang/steps/kimi/structured.steps.ts`
- `e2e/heyang/steps/kimi/tool.steps.ts`
- `e2e/heyang/steps/smoke.steps.ts`
- `e2e/heyang/support/hooks.ts`
- `e2e/heyang/support/world.ts`
- `scripts/heyang/preflight-check.sh`
- `scripts/heyang/run-e2e.sh`

### 已暂存文件

无。`git diff --cached --name-status` 输出为空。

## 2. 当前分支

### `git branch --show-current`

```text
heyang/2026-05-15-H02-tech-debt-tracker
```

### 当前分支 tracking remote

当前分支没有 upstream/tracking remote。`git rev-parse --abbrev-ref --symbolic-full-name @{u}` 无输出。

### `git log --oneline -20`

```text
e08fa49a98 fix(heyang): P01-fix dedupe tools and kimi compat
2d6936c517 docs(heyang): G01 establish project conventions
ffd66d5465 📝 docs: simplify and refresh skill docs (#14785)
d00770a956 💄 style: AnalyzeVisualMedia inspector, Portal HTML preview refactor & CE trace dedup (#14777)
20267fc77c 🔨 chore(memory-user-memory): add benchmark agent config (#14779)
4630785870 🔨 chore(memory-user-memory): support source ids in extraction schemas (#14778)
5b7611615e 🐛 fix: system bot error (#14784)
ec547a3b57 🐛 fix(topic): restore indent for heterogeneous agent topic rows (#14783)
36c4be46f0 🐛 fix(desktop): split runtime externals from native deps (#14776)
7b136a210f 🐛 fix(agent-signal): avoid blocking agent execution (#14775)
9075d5dfd3 refactor: merge agent marketplace into web onboarding
1c429f8d28 ✨ feat(chat): add Onboarding request trigger and pass via metadata (#14770)
ac250b9897 ♻️ refactor(agent-signal,server,app,database,locales): self iteration exits lab (#14769)
e8b7fe14e1 🐛 fix(server,memory-user-memory): embedding token exceeded, should limit and cut off searched memory query (#14757)
79cf5febed 🐛 fix(kb): preserve files on NoSuchKey and clean orphan documents/tasks (#14501)
4b6b341951 💄 fix(nav-panel): polish SideBarDrawer & header layout details (#14762)
44892960e0 ✨ feat: add Agent Signal marker to receipt descriptions (#14764)
dc86f38dc1 🐛 fix(onboarding): hide ModeSwitch in production environment (#14760)
3e43683132 🔨 chore(heteroContext): clarify sandbox TTL and add public-repo fork push guide (#14761)
2cfe9f6180 🌐 chore: translate non-English comments to English in file-loaders (#14744)
```

结论：当前 H02 分支 HEAD 实际停在 P01-fix 提交 `e08fa49a98`，H02 自己尚无提交。

## 3. 本地分支清单

### `git branch -vv`

```text
  canary                                  c19f87fdb2 [origin/canary: behind 28] Merge remote-tracking branch 'origin/main' into canary
+ claude/quizzical-cray-4f1f30            c19f87fdb2 (E:/heyu_project/lobehub/.claude/worktrees/quizzical-cray-4f1f30) [origin/canary: behind 28] Merge remote-tracking branch 'origin/main' into canary
  heyang/2026-05-14-G01-conventions       2d6936c517 [fork/heyang/2026-05-14-G01-conventions] docs(heyang): G01 establish project conventions
  heyang/2026-05-14-P01-fix-kimi-tools    e08fa49a98 [fork/heyang/2026-05-14-P01-fix-kimi-tools] fix(heyang): P01-fix dedupe tools and kimi compat
* heyang/2026-05-15-H02-tech-debt-tracker e08fa49a98 fix(heyang): P01-fix dedupe tools and kimi compat
  heyang/predev-audit-p01                 3486fe6b48 [fork/heyang/predev-audit-p01: gone] :memo: docs: add heyang predev audit notes
```

### 本地分支状态摘要

| 分支                                      | 最后提交     | upstream                                    | ahead/behind | 是否已推远程        |
| ----------------------------------------- | ------------ | ------------------------------------------- | ------------ | ------------------- |
| `canary`                                  | `c19f87fdb2` | `origin/canary`                             | behind 28    | 否，仅本地旧 canary |
| `claude/quizzical-cray-4f1f30`            | `c19f87fdb2` | `origin/canary`                             | behind 28    | 否，另一个 worktree |
| `heyang/2026-05-14-G01-conventions`       | `2d6936c517` | `fork/heyang/2026-05-14-G01-conventions`    | 0/0          | 是                  |
| `heyang/2026-05-14-P01-fix-kimi-tools`    | `e08fa49a98` | `fork/heyang/2026-05-14-P01-fix-kimi-tools` | 0/0          | 是                  |
| `heyang/2026-05-15-H02-tech-debt-tracker` | `e08fa49a98` | 无                                          | 无 upstream  | 否                  |
| `heyang/predev-audit-p01`                 | `3486fe6b48` | `fork/heyang/predev-audit-p01`              | gone         | 远程已不存在        |

## 4. 远程分支清单

远程：

```text
fork   https://github.com/kingheu0818-sketch/lobehub_yu.git
origin https://github.com/lobehub/lobehub.git
```

`git branch -r` 当前共 521 条远程分支。与本次任务直接相关的远程分支如下：

```text
fork/HEAD -> fork/canary
fork/canary
fork/heyang/2026-05-14-G01-conventions
fork/heyang/2026-05-14-P01-fix-kimi-tools
origin/HEAD -> origin/canary
origin/canary
origin/main
```

重点结论：

- 已推到 GitHub fork 的 heyang 分支只有两个：
  - `fork/heyang/2026-05-14-G01-conventions`
  - `fork/heyang/2026-05-14-P01-fix-kimi-tools`
- 没有发现远程 `fork/heyang/2026-05-15-H02-tech-debt-tracker`。
- 没有发现 P02-A / P02-B 命名的远程分支。

## 5. 主分支状态

### canary 差距

```text
git rev-parse canary        -> c19f87fdb263d6ea9c0f6024bbcfa535b8e94926
git rev-parse origin/canary -> ffd66d54655468d05292bfb67a1efda4e31bc502
git rev-parse fork/canary   -> ffd66d54655468d05292bfb67a1efda4e31bc502
```

```text
git rev-list --left-right --count canary...origin/canary -> 0 28
git rev-list --left-right --count canary...fork/canary   -> 0 28
git rev-list --left-right --count origin/canary...fork/canary -> 0 0
```

结论：

- 本地 `canary` 落后 `origin/canary` 28 个提交。
- `fork/canary` 与 `origin/canary` 当前一致。
- 当前 H02 分支不是从本地旧 `canary` 继续的，而是包含 `origin/canary` 最新点 `ffd66d5465` 后再叠了 G01 + P01-fix 两个提交。

### G01/P01-fix 是否进入主干

```text
git branch -r --contains 2d6936c517
  fork/heyang/2026-05-14-G01-conventions
  fork/heyang/2026-05-14-P01-fix-kimi-tools

git branch -r --contains e08fa49a98
  fork/heyang/2026-05-14-P01-fix-kimi-tools
```

结论：

- G01 没有进入 `origin/canary`、`fork/canary` 或 `origin/main`。
- P01-fix 没有进入 `origin/canary`、`fork/canary` 或 `origin/main`。
- `fork/main` 本地没有远程跟踪分支引用；当前只看到 `fork/canary`。

## 6. 每个任务的真实状态推断

| 任务             | 当前所在位置                                                                                                                        |     a) 提交已推到远程？ | b) 已合并到 main/canary？ |                                                             c) 改动还在工作区未提交？ |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------: | ------------------------: | ------------------------------------------------------------------------------------: |
| G01/H00          | 本地 `heyang/2026-05-14-G01-conventions`；远程 `fork/heyang/2026-05-14-G01-conventions`；提交 `2d6936c517`                          |                      是 |                        否 |                                                                否，G01/H00 本体已提交 |
| P01-fix          | 本地 `heyang/2026-05-14-P01-fix-kimi-tools`；远程 `fork/heyang/2026-05-14-P01-fix-kimi-tools`；提交 `e08fa49a98`                    |                      是 |                        否 | 基础修复否；但 `packages/business/heyang/src/kimi-compat.test.ts` 有 P02-B 扩充未提交 |
| F01              | 没有发现独立分支 / 提交；文档 `docs/heyang/issues/F01-failed-to-get-session.md` 未跟踪                                              |                      否 |                        否 |                                                                                    是 |
| P02-A            | 没有发现独立分支 / 提交；`e2e/heyang` smoke、`scripts/heyang`、`docs/heyang/LOCAL-DEV-SETUP.md` 等未跟踪 / 未提交                   |                      否 |                        否 |                                                                                    是 |
| P02-B            | 没有发现独立分支 / 提交；`e2e/heyang/features/kimi-compat/*`、`e2e/heyang/steps/kimi/*`、fixtures、`kimi-compat.test.ts` 扩充未提交 |                      否 |                        否 |                                                                                    是 |
| H02              | 当前分支 `heyang/2026-05-15-H02-tech-debt-tracker`，但 HEAD 仍是 P01-fix；`docs/heyang/TECH-DEBT.md` 未跟踪                         |                      否 |                        否 |                                                                                    是 |
| T00/P01 排查文档 | 历史分支 `heyang/predev-audit-p01` 本地存在；远程 upstream 显示 gone；提交 `3486fe6b48`                                             | 曾推过，但当前远程 gone |                        否 |                                                            当前工作区未见这批文档改动 |

## 7. 风险评估

### 可能丢失的工作

高风险：以下内容尚未提交，任何误用 `git reset --hard`、错误 checkout 清理、删除未跟踪文件，都可能丢失：

- F01 文档：`docs/heyang/issues/F01-failed-to-get-session.md`
- H02 文档：`docs/heyang/TECH-DEBT.md`
- P02-A 全部 E2E smoke /preflight/ 本地文档
- P02-B 全部 Kimi 真实兼容 E2E /fixtures/ 测试扩充
- `package.json` 中新增脚本
- `docs/heyang/CHANGELOG-heyang.md` 未提交增量
- `packages/business/heyang/src/kimi-compat.test.ts` 未提交增量

### 当前是否能干净地建任何新 PR

不能。当前工作区有 3 个 modified 文件和 26 个未跟踪文件；当前分支也没有 upstream。

### 当前是否能干净地切到 canary 起新分支

不能。因为存在大量未提交 / 未跟踪文件，直接切分支会把这些改动带过去，甚至可能和目标分支文件冲突。

### 当前主干合并风险

- G01 和 P01-fix 已经推到 fork 分支，但未合入 `fork/canary` / `origin/canary`。
- F01/P02-A/P02-B/H02 尚未形成提交，更没有 PR 边界。
- 当前 H02 分支名会让人误以为 H02 已经在独立分支上，但实际上 H02 只有未跟踪文档，HEAD 仍是 P01-fix。

## 8. 建议的下一步（仅建议，不执行）

方案 A：按任务拆 PR，历史最清楚。

1. 先确认 / 合并 `fork/heyang/2026-05-14-G01-conventions`。
2. 再确认 / 合并 `fork/heyang/2026-05-14-P01-fix-kimi-tools`。
3. 基于合并后的 canary，单独整理 F01 文档 PR。
4. 单独整理 P02-A E2E 基建 PR。
5. 单独整理 P02-B Kimi 兼容测试 PR。
6. 最后整理 H02 技术债文档 PR。

优点：PR 边界清楚，方便回滚和评审。缺点：需要先安全保存当前未提交工作，再逐个拆分。

方案 B：把 F01 + P02-A + P02-B + H02 捏成一个大 PR。

优点：当前工作区最省整理时间。缺点：范围很大，评审困难；如果某个测试或文档需要回滚，会拖累所有内容。

方案 C：保留当前分支为临时收纳分支，先提交一个 WIP，再开新分支拆分。

优点：先降低丢失风险。缺点：WIP 提交需要后续 rebase/cherry-pick 拆历史。

我的判断：当前最重要的是先不要切分支、不要清理工作区。需要先决定采用 A/B/C 哪种整理策略。

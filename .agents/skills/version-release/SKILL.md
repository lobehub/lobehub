---
name: version-release
description: "版本发布工作流。当用户提到 '发版'、'发布'、'release'、'hotfix'、'版本升级'、'小班车' 时使用。提供 Minor Release 和 Patch Release 两种发版流程指引。"
---

# 版本发布工作流

## 概述

本项目主要开发分支为 **canary**，所有日常开发在 canary 上进行。发版时从 canary 合入 main，合入后由 `auto-tag-release.yml` 自动完成打 tag、bump version、创建 GitHub Release、同步回 canary 分支。

日常开发中只涉及两种发版类型（major 极少使用，可忽略）：

| 类型  | 适用场景                            | 频率              | 源分支         | PR 标题格式                       | 版本号        |
| ----- | ----------------------------------- | ----------------- | -------------- | --------------------------------- | ------------- |
| Minor | 功能迭代版本                        | \~4 周一次        | canary         | `🚀 release: v{x.y.0}`            | 手动指定      |
| Patch | 每周小班车 /hotfix/model /db 修复等 | \~ 每周一次或按需 | canary 或 main | 自定（如 `🚀 release: 20260222`） | 自动 patch +1 |

## Minor Release 流程

用于发布新的 minor 版本（如 v2.2.0），约 4 周一次。

### 步骤

1. **从 canary 创建 release 分支**

```bash
git checkout canary
git pull origin canary
git checkout -b release/v{version}
git push -u origin release/v{version}
```

2. **确定版本号** — 读取 `package.json` 当前版本，计算下一个 minor 版本（如 2.1.x → 2.2.0）

3. **创建 PR 到 main**

```bash
gh pr create \
  --title "🚀 release: v{version}" \
  --base main \
  --head release/v{version} \
  --body "## 📦 Release v{version} ..."
```

> **关键**：PR 标题必须严格匹配 `🚀 release: v{x.y.z}` 格式，CI 通过正则检测此标题来确定精确版本号。

4. **合并后自动触发**：auto-tag-release 检测到标题格式，使用标题中的版本号完成发版。

### 对应脚本

```bash
bun run release:branch         # 交互式
bun run release:branch --minor # 直接指定 minor
```

## Patch Release 流程

版本号自动 patch +1，有 4 种常见场景：

| 场景                | 源分支 | 分支命名                      | 说明                               |
| ------------------- | ------ | ----------------------------- | ---------------------------------- |
| Weekly Release      | canary | `release/weekly-{YYYYMMDD}`   | 每周小班车，canary → main          |
| Bug Hotfix          | main   | `hotfix/v{version}-{hash}`    | 紧急 bug 修复                      |
| New Model Launch    | canary | 社区 PR 直接合入              | 新模型上线，通过 PR title 前缀触发 |
| DB Schema Migration | canary | `release/db-migration-{name}` | 数据库迁移，需专门 changelog       |

所有场景版本号均自动 patch +1，Patch PR 标题不需要写版本号。各场景详细流程参见 `references/patch-release-scenarios.md`。

### 对应脚本

```bash
bun run hotfix:branch # hotfix 场景
```

## 自动发版触发规则（auto-tag-release.yml）

PR 合入 main 后，CI 按以下优先级判断是否发版：

### 1. Minor Release（精确版本）

PR 标题匹配 `🚀 release: v{x.y.z}` → 使用标题中的版本号。

### 2. Patch Release（自动 patch +1）

按以下优先级触发：

- **分支名匹配**：`hotfix/*` 或 `release/*` → 直接触发（跳过标题检测）
- **标题前缀匹配**：以下前缀的 PR 标题会触发：
  - `style` / `💄 style`
  - `feat` / `✨ feat`
  - `fix` / `🐛 fix`
  - `refactor` / `♻️ refactor`
  - `hotfix` / `🐛 hotfix` / `🩹 hotfix`
  - `build` / `👷 build`

### 3. 不触发

不满足以上任何条件的 PR（如 `docs`、`chore`、`ci`、`test` 前缀）合入 main 后不会发版。

## 发版后自动动作

1. **Bump package.json** — 提交 `🔖 chore(release): release version v{x.y.z} [skip ci]`
2. **创建 annotated tag** — `v{x.y.z}`
3. **创建 GitHub Release**
4. **Dispatch sync-main-to-canary** — 同步 main 回 canary 分支

## Claude 操作指引

当用户要求发版时：

### Minor Release

1. 读取 `package.json` 获取当前版本，计算下一个 minor 版本
2. 从 canary 创建 `release/v{version}` 分支
3. 推送并创建 PR，**标题必须为 `🚀 release: v{version}`**
4. 告知用户合并 PR 后将自动发版

### Patch Release（小班车）

1. 从 canary 创建 `release/weekly-{YYYYMMDD}` 分支
2. 执行 `git log main..canary --oneline` 扫描变更
3. 以面向用户的视角撰写 changelog（新功能 / 优化 / 修复），写入 PR body
4. 推送并创建 PR，标题如 `🚀 release: 20260222`
5. 告知用户合并 PR 后将自动 patch +1 发版

### Patch Release（hotfix）

1. 从 main 创建 `hotfix/v{version}-{hash}` 分支
2. 推送并创建 PR，标题使用 gitmoji 前缀（如 `🐛 fix: ...`）
3. 告知用户合并 PR 后将自动 patch +1 发版

### 注意事项

- **不要手动修改 package.json 的 version** — CI 会自动 bump
- **不要手动打 tag** — CI 会自动创建
- Minor Release 的 PR 标题格式是硬性要求，格式错误将不会使用指定版本号
- Patch PR 不需要写版本号，CI 自动 patch +1
- 所有发版 PR 都需要包含面向用户的 changelog

## Changelog 撰写规范

所有发版 PR（无论 Minor 还是 Patch）的 body 都需要包含面向用户视角的变更日志。通过 `git log main..canary --oneline` 或 `git diff main...canary --stat` 扫描变更后，按以下格式撰写。

### 格式参考

参见 `references/patch-release-changelog-example.md`。

### 撰写要点

- **面向用户**：描述用户可感知的变化，而非内部实现细节
- **分类清晰**：按功能特性、模型 / Provider、桌面端、修复稳定性等分类
- **标注重点**：关键功能名用 `**加粗**` 突出
- **致谢贡献者**：通过 `git log` 收集所有 committer，按字母序列出
- **分类可灵活调整**：根据实际变更内容选用合适的分类，不必强行套用所有分类

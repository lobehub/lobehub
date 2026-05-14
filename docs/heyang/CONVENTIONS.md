# 企业改造项目协作铁律

本文件是企业化改造的协作基线。每个新任务的「背景」段都必须引用本文件，并说明本次任务是否需要突破其中的限制。

## 一、四条核心原则（已在摸底报告后确立）

1. business 覆盖层优先：能放 `packages/business/heyang` 就不放 `src/` 和上游 `packages`
2. 新表前缀 `heyang_`：所有自研表必须加前缀
3. env 开关包裹一切：所有企业扩展特性默认 off
4. 服务端挂点优先：审计、加密、权限挂服务端，前端只做 UX

## 二、上游高冲突文件清单（禁止动）

以下文件被标记为「高上游同步冲突风险」，未经显式授权不得修改：

- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`
- `src/initialize.ts`
- `src/services/chat/index.ts`
- `src/store/chat/agents/createAgentExecutors.ts`
- `packages/agent-runtime/src/core/runtime.ts`
- `src/helpers/toolEngineering/index.ts`

如果任务必须动这些文件，必须在任务定义里显式列出，并说明无法外挂的理由。

## 三、临时调试代码规范

1. 不允许散落的 `console.log`。所有诊断输出必须通过 `packages/business/heyang/src/diagnostics.ts`
2. 不允许新增散落的 `DEBUG_XXX` env。统一开关是 `HEYANG_DIAGNOSTICS_ENABLED`
3. 诊断输出默认 off，开关 on 时输出到 stderr
4. 任务完成后必须清理本任务引入的所有诊断输出（除非显式保留）

## 四、文件与目录规范

允许新增的目录：

- `packages/business/heyang/`：企业扩展层
- `docs/heyang/`：企业文档
- 测试文件就近放在被测代码旁

禁止新增的目录：

- `.codex/`、`.claude/`、任何 AI 工具自留目录
- 根目录下任何临时脚本目录

新增数据库表必须前缀 `heyang_`：

- `heyang_audit_log`
- `heyang_usage_record`
- `heyang_enterprise_skill`
- `...`

## 五、任务执行流程

1. 严格按任务的「允许修改」清单执行，不扩大范围
2. 提交前对照「越界检查清单」自查
3. 改动上游文件必须在 `CHANGELOG-heyang.md` 登记
4. 发现需要超出范围才能完成时，停下来说明理由，等评审

## 六、PR 规范

- 分支名：`heyang/YYYY-MM-DD-<任务编号>-<简述>`
- PR 标题：`<type>(heyang): <任务编号> <简述>`
- `type` 用 conventional commits：`feat` / `fix` / `test` / `docs` / `chore` / `refactor`
- PR 描述必须包含：
  - □ 任务编号
  - □ `git diff --stat`
  - □ 越界检查清单自查结果
  - □ 验收截图或日志

## 七、不可越线

- 不动认证核心（`src/auth.ts`、Better Auth 配置）除非有专门的认证任务
- 不动数据库迁移历史（`packages/database/migrations/*.sql` 已存在文件不可改）
- 不动 CI 配置（`.github/workflows/*`）除非有专门的 CI 任务
- 不引入新的顶级依赖（`package.json` dependencies）除非任务明确允许

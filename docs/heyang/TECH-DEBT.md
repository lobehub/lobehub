# 衡阳改造项目技术债登记

本文件登记所有 "临时方案 / 欠优化 / 待迁移" 项目。
每个 TD 必须包含：编号、引入任务、位置、临时方案、
解除条件、影响范围、状态。

## TD-001: smoke test 中 /api/health 回退到 /api/agent/run

- 引入任务：P02-A
- 位置：e2e/heyang/steps/smoke.steps.ts
- 临时方案：/api/health 返回非 200 时回退到 /api/agent/run
- 解除条件：项目落地正式 /api/health 端点（暴露 DB / SPA /external API 状态）
- 解除时同步删除：smoke test 的 fallback 分支、TESTING.md 中的说明
- 影响范围：smoke test 不能严格反映健康端点的真实状态
- 状态：开放

## TD-002: 登录页品牌验证接受 LobeHub fallback

- 引入任务：P02-A
- 位置：e2e/heyang/steps/smoke.steps.ts、e2e/heyang/README.md、docs/heyang/TESTING.md
- 临时方案：登录页未渲染 "衡阳镭目" 时接受 "LobeHub"
- 解除条件：T03 企业品牌外壳任务完成
- 解除方式：T03 完成后删除 fallback 分支，删除 HEYANG_E2E_STRICT_BRAND 开关
- 影响范围：品牌替换不完整时 smoke 仍能通过
- 状态：开放

## TD-003: 本地 DB 使用 POSTGRES_HOST_AUTH_METHOD=trust

- 引入任务：F01
- 位置：docs/heyang/LOCAL-DEV-SETUP.md
- 临时方案：本地开发库无密码，使用 trust 认证
- 解除条件：生产部署任务完成
- 解除方式：生产 docker-compose 强制要求 DATABASE_URL 含密码 + 启动脚本校验
- 影响范围：仅限本地环境，但需注意不能流到生产
- 状态：开放

## 登记规范

后续任务如果引入技术债，必须：

1. 在本文件追加 TD-NNN（编号顺序累加，不复用）
2. 在代码引入处添加注释：// TODO (TD-NNN): < 一句话说明 >
3. 在 PR 描述里说明引入原因和解除条件
4. 解除时：把状态改为 "已解决"，并记录解除任务编号和日期，但不要删除条目

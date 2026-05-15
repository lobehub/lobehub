# 衡阳 E2E 测试说明

## 目标

P02-A 先把自动化测试基础设施跑起来，重点覆盖 F01 暴露出的本地服务启动问题：只启动 Next、不启动 Vite SPA 时，首页会 500。

## 命令

```powershell
pnpm heyang:preflight
pnpm heyang:e2e
```

`pnpm heyang:e2e` 会先运行 preflight，再运行 `e2e/heyang/features/smoke.feature`。

如果 Windows PowerShell 找不到 `pnpm`，使用：

```powershell
corepack.cmd pnpm heyang:preflight
corepack.cmd pnpm heyang:e2e
```

## smoke 覆盖范围

- 服务健康检查：优先访问 `/api/health`，当前上游会回退到现有公开健康端点 `/api/agent/run`。
- 登录页渲染：访问 `/signin`，确认页面至少有可点击登录按钮。
- 数据库连接：访问需要 session 的页面，确认没有返回 `FAILED_TO_GET_SESSION` 或 500。

非破坏性验证 Vite 失败分支时，可以临时指定一个未监听端口：

```powershell
$env:HEYANG_PREFLIGHT_VITE_PORT="65530"
corepack.cmd pnpm heyang:preflight
Remove-Item Env:\HEYANG_PREFLIGHT_VITE_PORT
```

## 报告文件

运行后会生成：

```text
e2e/reports/heyang-cucumber-report.json
e2e/reports/heyang-cucumber-report.html
```

Windows 默认使用系统 Edge 通道，避免首次运行必须下载 Playwright Chromium。如果机器没有 Edge，执行：

```powershell
corepack.cmd pnpm exec playwright install chromium
```

## 当前已知临时兼容

当前仓库还没有独立公开的 `/api/health` 路由，也尚未完成企业品牌替换。为了先让 smoke test 成为可用的启动哨兵，测试里保留了两个临时兼容：

这两项是技术债 TD-001 / TD-002，详见 docs/heyang/TECH-DEBT.md。

- `/api/health` 不返回 200 时，回退到 `/api/agent/run`（TD-001）。
- 登录页未出现 `衡阳镭目` 时，默认接受上游品牌 `LobeHub`（TD-002）。

企业品牌任务完成后，设置 `HEYANG_E2E_STRICT_BRAND=1`，品牌检查会变成硬校验。

## Kimi 真实兼容测试

P02-B 新增 `e2e/heyang/features/kimi-compat/`，专门覆盖真实 NewAPI + `kimi-k2.6` 的兼容场景：

- `basic-chat.feature`：简单问候、多轮记忆、流式输出。
- `tool-call-roundtrip.feature`：单工具、多工具、工具失败恢复、thinking 参数清理。
- `structured-output.feature`：`response_format=json_object`。
- `long-context.feature`：约 8K 上下文与哨兵信息引用。
- `mcp-with-duplicates.feature`：重复 `api.name` 的 MCP manifest 去重，以及正常 manifest 兼容。

真实模型测试默认不进普通 smoke。运行前在本地 `.env.e2e` 或 `.env` 配置：

```text
HEYANG_KIMI_BASE_URL=http://172.17.111.60:8095/innerapi/newapi/v1
HEYANG_KIMI_API_KEY=sk-...
HEYANG_KIMI_MODEL=kimi-k2.6
HEYANG_KIMI_TEMPERATURE=1
```

不同 NewAPI 渠道可能要求不同 temperature。当前实测 `kimi-k2.6` 要求 `1`；如果服务端返回 `invalid temperature: only X is allowed for this model`，把 `HEYANG_KIMI_TEMPERATURE` 改成对应值。

运行 Kimi 专项：

```powershell
$env:HEYANG_E2E_TAGS="@real-llm"
corepack.cmd pnpm heyang:e2e
Remove-Item Env:\HEYANG_E2E_TAGS
```

报告位置：

```text
e2e/heyang/reports/latest.html
e2e/heyang/reports/latest.json
```

本套测试使用真实 NewAPI，不 mock LLM，通常 2-5 分钟内完成；它会消耗测试 Key 的额度。

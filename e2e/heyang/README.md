# 衡阳 E2E Smoke Tests

本目录放衡阳企业化改造专属 E2E 用例，不修改上游 `e2e/src`。

运行方式：

```powershell
pnpm heyang:preflight
pnpm heyang:e2e
```

默认目标：

```text
BASE_URL=http://localhost:3010
HEADLESS=true
HEYANG_E2E_BROWSER_CHANNEL=msedge
```

当前上游没有独立公开的 `/api/health` 路由，`/api/health` 会被登录中间件重定向。为保证 smoke test 能先覆盖 F01 类启动问题，健康检查步骤会优先尝试 `/api/health`，失败后使用现有公开健康端点 `/api/agent/run`。后续如果新增正式 `/api/health`，这个兼容分支可以删除。

Windows 默认复用系统 Edge，不强制下载 Playwright 自带 Chromium。如果本机没有 Edge，先执行：

```powershell
corepack.cmd pnpm exec playwright install chromium
```

品牌检查默认允许当前上游品牌 `LobeHub` 作为临时 fallback。企业品牌落地后，设置：

```powershell
$env:HEYANG_E2E_STRICT_BRAND="1"
pnpm heyang:e2e
```

这样登录页必须渲染 `衡阳镭目` 才会通过。

Kimi 真实兼容专项默认不随 smoke 跑。运行：

```powershell
$env:HEYANG_E2E_TAGS="@real-llm"
corepack.cmd pnpm heyang:e2e
Remove-Item Env:\HEYANG_E2E_TAGS
```

HTML 报告输出到 `e2e/heyang/reports/latest.html`。

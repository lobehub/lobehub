# P01 工具 function name 重复排查与修复记录

## 状态

已修复。

## 复现步骤

1. 使用包含重复 `api.name` 的 MCP manifest。
2. 通过 `ToolsEngine.generateTools()` 生成传给模型的 `tools` 数组。
3. 修复前会生成两个相同的 wire function name：

```text
emblemcompany-agent-skills____getPolyMarketEvents____mcp
emblemcompany-agent-skills____getPolyMarketEvents____mcp
```

NewAPI/Moonshot 对 `tools[].function.name` 要求全局唯一，因此请求被拒绝。

## 诊断日志

开启：

```powershell
$env:HEYANG_DIAGNOSTICS_ENABLED='1'
```

修复后的去重日志：

```text
[heyang:warn] duplicate-tool-function-name-dropped {"manifestCount":1,"source":"ToolsEngine.convertManifestsToTools","functionName":"emblemcompany-agent-skills____getPolyMarketEvents____mcp"}
```

## 根因

文件：

- `packages/context-engine/src/engine/tools/ToolsEngine.ts`
- `packages/context-engine/src/engine/tools/utils.ts`

`convertManifestsToTools` 和 `generateToolsFromManifest` 原来直接对 `manifest.api` 做 `map`，没有按最终 wire 层 `function.name` 去重。单个 MCP manifest 内部如果出现同名 `api.name`，经过 `ToolNameResolver` 拼接后会得到重复的 `function.name`。

## 修复说明

1. 在 `packages/context-engine/src/engine/tools/utils.ts` 新增 `dedupeUniformToolsByName`。
2. `packages/context-engine/src/engine/tools/ToolsEngine.ts` 在 `convertManifestsToTools` 出口按 `function.name` 保留第一项、丢弃后续重复项。
3. `packages/context-engine/src/engine/tools/utils.ts` 的 `generateToolsFromManifest` 同样复用该去重函数，覆盖直接从单个 manifest 生成工具的路径。
4. 重复丢弃时通过 `packages/business/heyang/src/diagnostics.ts` 输出诊断，默认关闭，使用 `HEYANG_DIAGNOSTICS_ENABLED=1` 开启。

## 回归测试

新增用例：

- `packages/context-engine/src/engine/tools/__tests__/ToolsEngine.test.ts`

验证项：

- 构造一个单 MCP manifest 内部重复 `api.name` 的场景。
- 断言最终 `tools` 数组只保留一个 `emblemcompany-agent-skills____getPolyMarketEvents____mcp`。
- 断言保留第一项，避免行为不稳定。

# 文生图员工切换到 Nano Banana 设计

## 目标

将本地 “文生图 AI 员工” 的默认预设模型从 `moonshot/kimi-k2.5` 切换为 `google/gemini-2.5-flash-image`，并保持共享员工同步逻辑与测试一致。

## 方案

- 仅修改 `src/server/services/user/presetAgents.ts` 中 “文生图 AI 员工” 的 `provider` 与 `model`
- 保持现有共享员工同步逻辑不变，由它负责把已有本地 `shared_agents` 旧记录同步到新预设
- 同步更新 `src/server/services/sharedAgent/syncPresetSharedAgents.test.ts` 的断言

## 验证

- 运行共享员工同步测试，确认创建 / 更新 / 跳过更新三种场景都通过

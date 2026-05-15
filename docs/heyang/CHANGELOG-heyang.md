# 企业化改造记录

- 2026-05-14 G01/H00：建立 `docs/heyang/CONVENTIONS.md` 协作铁律；按规范作废 P01 排查阶段临时代码改动，后续通过 P01-fix 重新实施。
- 2026-05-14 P01-fix：修复 MCP/Skill 工具 function name 重复问题，新增工具去重诊断与回归测试。
- 2026-05-14 P01-fix：新增 NewAPI Kimi 兼容层，统一处理 `thinking` 参数与 tool_call 历史消息的 `reasoning_content` 兼容。
- 2026-05-15 P02-A：新增衡阳 E2E smoke 基础设施与本地 preflight 检查，固化 F01 的完整 dev 栈启动要求。
- 2026-05-15 P02-B：新增 Kimi/NewAPI 真实兼容 E2E 套件，覆盖基础聊天、工具回填、结构化输出、长上下文与 MCP 重复工具去重。
- 2026-05-15 H02：建立 `docs/heyang/TECH-DEBT.md` 技术债登记机制，登记 TD-001/002/003。

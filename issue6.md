### Description
According to the LobeHub Code Style guidelines: *"When a single file grows beyond ~800 lines, consider splitting it into multiple files"*. 

Currently, RuntimeExecutors.ts has grown to over 4,200 lines of code, making it difficult to navigate, review, and maintain for both developers and AI agents.

### Location to update
- [apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts](https://github.com/lobehub/lobe-chat/blob/main/apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts)

### Expected Behavior
Refactor this monolithic file by extracting sub-components, helper functions, types, and logic blocks into smaller, focused modules within the AgentRuntime directory.

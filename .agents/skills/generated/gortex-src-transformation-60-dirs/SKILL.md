---
name: gortex-src-transformation-60-dirs
description: 'Work in the src/transformation +60 dirs area — 462 symbols across 85 files (82% cohesion)'
---

# src/transformation +60 dirs

462 symbols | 85 files | 82% cohesion

## When to Use

Use this skill when working on files in:

- `apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts`
- `packages/agent-manager-runtime/src/AgentManagerRuntime.ts`
- `packages/agent-manager-runtime/src/types.ts`
- `packages/agent-mock/src/builders/defineCase.ts`
- `packages/agent-mock/src/builders/helpers.ts`
- `packages/agent-mock/src/snapshot/loadSnapshot.ts`
- `packages/agent-mock/src/snapshot/snapshotToEvents.test.ts`
- `packages/agent-mock/src/snapshot/snapshotToEvents.ts`
- `packages/agent-mock/src/types.ts`
- `packages/agent-runtime/src/agents/GeneralChatAgent.ts`
- `packages/agent-runtime/src/types/generalAgent.ts`
- `packages/builtin-tool-activator/src/ExecutionRuntime/index.ts`
- `packages/context-engine/src/engine/topicReference/resolveTopicReferences.ts`
- `packages/context-engine/src/pipeline.ts`
- `packages/context-engine/src/tokenAccounting/__tests__/attachmentTokenBuckets.test.ts`
- `packages/context-engine/src/tokenAccounting/attachmentTokenBuckets.ts`
- `packages/context-engine/src/types.ts`
- `packages/conversation-flow/src/transformation/BranchResolver.ts`
- `packages/conversation-flow/src/transformation/FlatListBuilder.ts`
- `packages/conversation-flow/src/transformation/MessageCollector.ts`
- `packages/conversation-flow/src/transformation/MessageTransformer.ts`
- `packages/conversation-flow/src/transformation/__tests__/FlatListBuilder.test.ts`
- `packages/conversation-flow/src/transformation/__tests__/MessageCollector.test.ts`
- `packages/conversation-flow/src/transformation/index.ts`
- `packages/conversation-flow/src/types/contextTree.ts`
- `packages/database/src/repositories/home/index.ts`
- `packages/file-loaders/src/loaders/excel/index.ts`
- `packages/file-loaders/src/utils/parser-utils.ts`
- `packages/heterogeneous-agents/src/adapters/claudeCode.ts`
- `packages/heterogeneous-agents/src/spawn/agentStreamPipeline.ts`
- `packages/heterogeneous-agents/src/spawn/spawnAgent.test.ts`
- `packages/heterogeneous-agents/src/types.ts`
- `packages/local-file-shell/src/file/move.ts`
- `packages/local-file-shell/src/types.ts`
- `packages/model-bank/src/types/aiModel.ts`
- `packages/model-runtime/src/core/streams/bedrock/llama.ts`
- `packages/model-runtime/src/core/streams/google/index.ts`
- `packages/model-runtime/src/core/streams/ollama.ts`
- `packages/model-runtime/src/core/streams/openai/openai.ts`
- `packages/model-runtime/src/core/streams/protocol.ts`
- `packages/model-runtime/src/core/streams/qwen.ts`
- `packages/model-runtime/src/core/streams/spark.ts`
- `packages/model-runtime/src/core/usageConverters/openai.ts`
- `packages/model-runtime/src/core/usageConverters/utils/computeChatCost.ts`
- `packages/model-runtime/src/core/usageConverters/utils/withUsageCost.ts`
- `packages/openapi/src/controllers/agent.controller.ts`
- `packages/prompts/src/prompts/userMemory/index.ts`
- `packages/types/src/files/upload.ts`
- `packages/types/src/tool/builtin.ts`
- `packages/types/src/userMemory/tools.ts`
- `scripts/countEnWord.ts`
- `scripts/i18nWorkflow/analyzeUnusedKeys.ts`
- `src/features/AgentMockDevtools/Timeline/EventRow.tsx`
- `src/features/AgentMockDevtools/hooks/useMockCases.ts`
- `src/features/ChatInput/InputEditor/ActionTag/useInstalledSkillsAndTools.ts`
- `src/features/ChatInput/InputEditor/useMentionCategories.tsx`
- `src/features/DevPanel/RenderGallery/MessageList.tsx`
- `src/features/DevPanel/RenderGallery/useDevtoolsEntries.ts`
- `src/features/Onboarding/Agent/NameSuggestions.tsx`
- `src/features/ResourceManager/components/LibraryHierarchy/index.tsx`
- `src/routes/(main)/home/features/WelcomeText/index.tsx`
- `src/routes/(main)/settings/hooks/useCategory.test.tsx`
- `src/routes/(main)/settings/hooks/useCategory.tsx`
- `src/server/modules/AgentRuntime/StreamEventManager.ts`
- `src/server/services/agentSignal/observability/projector.ts`
- `src/server/services/agentSignal/observability/types.ts`
- `src/server/services/agentSignal/policies/completionPolicy.test.ts`
- `src/server/services/agentSignal/services/selfIteration/completion/__test__/completionLoop.integration.test.ts`
- `src/server/services/agentSignal/services/selfIteration/feedback/__test__/handler.test.ts`
- `src/server/services/agentSignal/services/selfIteration/reflection/__test__/handler.test.ts`
- `src/server/services/agentSignal/services/selfIteration/review/__test__/handler.test.ts`
- `src/server/services/agentSignal/services/selfIteration/review/collect.ts`
- `src/server/services/agentSignal/services/selfIteration/review/signals.ts`
- `src/server/services/bot/platforms/discord/client.ts`
- `src/server/services/toolExecution/serverRuntimes/activator.ts`
- `src/services/chat/mecha/contextEngineering.ts`
- `src/services/chat/mecha/memoryManager.ts`
- `src/services/chat/mecha/skillEngineering.ts`
- `src/services/chat/mecha/skillPreload.ts`
- `src/services/chat/mecha/toolPreload.ts`
- `src/store/chat/agents/__tests__/createAgentExecutors/fixtures/mockMessages.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/clientToolExecution.test.ts`
- `src/store/file/reducers/uploadFileList.test.ts`
- `src/store/file/reducers/uploadFileList.ts`
- `src/store/tool/slices/builtin/executors/lobe-activator.ts`

## Key Files

| File                                                                                                            | Symbols                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts`                                                    | getRelevantCodexStderr, stderr                                                                         |
| `packages/agent-manager-runtime/src/AgentManagerRuntime.ts`                                                     | searchAgents, params                                                                                   |
| `packages/agent-manager-runtime/src/types.ts`                                                                   | SearchAgentParams                                                                                      |
| `packages/agent-mock/src/builders/defineCase.ts`                                                                | DefineCaseInput, errorStep, input, ErrorStepInput, llmStep, ...                                        |
| `packages/agent-mock/src/builders/helpers.ts`                                                                   | stepIndex, reason, stepStart, stepComplete, stepType, ...                                              |
| `packages/agent-mock/src/snapshot/loadSnapshot.ts`                                                              | snapshot, meta, snapshotToMockCase                                                                     |
| `packages/agent-mock/src/snapshot/snapshotToEvents.test.ts`                                                     | typesOf, events                                                                                        |
| `packages/agent-mock/src/snapshot/snapshotToEvents.ts`                                                          | SnapshotToEventsOptions, snapshotToEvents, opts, snapshot                                              |
| `packages/agent-mock/src/types.ts`                                                                              | MockEvent                                                                                              |
| `packages/agent-runtime/src/agents/GeneralChatAgent.ts`                                                         | config, getCurrentTurnPendingToolMessages, state, config, context, ...                                 |
| `packages/agent-runtime/src/types/generalAgent.ts`                                                              | GeneralAgentCallLLMInstructionPayload, GeneralAgentConfig                                              |
| `packages/builtin-tool-activator/src/ExecutionRuntime/index.ts`                                                 | ToolManifestInfo                                                                                       |
| `packages/context-engine/src/engine/topicReference/resolveTopicReferences.ts`                                   | lookupTopic, text, max, messages, truncate, ...                                                        |
| `packages/context-engine/src/pipeline.ts`                                                                       | addProcessor, processor                                                                                |
| `packages/context-engine/src/tokenAccounting/__tests__/attachmentTokenBuckets.test.ts`                          | mkUploadFile                                                                                           |
| `packages/context-engine/src/tokenAccounting/attachmentTokenBuckets.ts`                                         | isTextLikeUploadFile, isTextLikeMimeType, files, estimateTextFileTokensBySize, getUploadFileUrl, ...   |
| `packages/context-engine/src/types.ts`                                                                          | Message                                                                                                |
| `packages/conversation-flow/src/transformation/BranchResolver.ts`                                               | childrenMap, message, childIds, getActiveBranchIdFromMetadata                                          |
| `packages/conversation-flow/src/transformation/FlatListBuilder.ts`                                              | taskChildIds, allToolMessages, isCompareMode, flatList, createCompareMessage, ...                      |
| `packages/conversation-flow/src/transformation/MessageCollector.ts`                                             | allToolMessages, sig, message, allMessages, findNextAfterTools, ...                                    |
| `packages/conversation-flow/src/transformation/MessageTransformer.ts`                                           | metadata, message, messageToContentBlock, MessageTransformer, aggregateMetadata, ...                   |
| `packages/conversation-flow/src/transformation/__tests__/FlatListBuilder.test.ts`                               | createBuilder, messages, messageGroupMap                                                               |
| `packages/conversation-flow/src/transformation/__tests__/MessageCollector.test.ts`                              | mkTool, opts, id                                                                                       |
| `packages/conversation-flow/src/transformation/index.ts`                                                        | flatten, messages                                                                                      |
| `packages/conversation-flow/src/types/contextTree.ts`                                                           | MessageNode, SignalCallbacksNode                                                                       |
| `packages/database/src/repositories/home/index.ts`                                                              | processAgentList, chatGroupItems, memberAvatarsMap, groupItems, agentItems                             |
| `packages/file-loaders/src/loaders/excel/index.ts`                                                              | jsonData, loadPages, sheetToMarkdownTable, filePath                                                    |
| `packages/file-loaders/src/utils/parser-utils.ts`                                                               | filterFn, zipInput, zipfile, processZipfile, extractFiles, ...                                         |
| `packages/heterogeneous-agents/src/adapters/claudeCode.ts`                                                      | emitToolChunk, handleAssistant, getTrailingCompletion, clearStreamedBuffers, makeChunkEvent, ...       |
| `packages/heterogeneous-agents/src/spawn/agentStreamPipeline.ts`                                                | push, chunk                                                                                            |
| `packages/heterogeneous-agents/src/spawn/spawnAgent.test.ts`                                                    | createFakeProc                                                                                         |
| `packages/heterogeneous-agents/src/types.ts`                                                                    | StreamChunkData                                                                                        |
| `packages/local-file-shell/src/file/move.ts`                                                                    | moveLocalFiles                                                                                         |
| `packages/local-file-shell/src/types.ts`                                                                        | MoveFileResultItem                                                                                     |
| `packages/model-bank/src/types/aiModel.ts`                                                                      | TieredPricingUnit, FixedPricingUnit                                                                    |
| `packages/model-runtime/src/core/streams/bedrock/llama.ts`                                                      | chunk, stack, transformLlamaStream, BedrockLlamaStreamChunk                                            |
| `packages/model-runtime/src/core/streams/google/index.ts`                                                       | blockReason, getCandidateBlockedReason, context, rawStream, payload, ...                               |
| `packages/model-runtime/src/core/streams/ollama.ts`                                                             | transformOllamaStream, stack, chunk                                                                    |
| `packages/model-runtime/src/core/streams/openai/openai.ts`                                                      | processMarkdownBase64Images, toolCall, streamContext, chunk, streamContext, ...                        |
| `packages/model-runtime/src/core/streams/protocol.ts`                                                           | process, chunk, StreamProtocolChunk, StreamContext, ChatPayloadForTransformStream, ...                 |
| `packages/model-runtime/src/core/streams/qwen.ts`                                                               | chunk, payload, streamContext, transformQwenStream, chunk, ...                                         |
| `packages/model-runtime/src/core/streams/spark.ts`                                                              | transformSparkStream, payload, chunk                                                                   |
| `packages/model-runtime/src/core/usageConverters/openai.ts`                                                     | usage, convertOpenAIUsage, payload                                                                     |
| `packages/model-runtime/src/core/usageConverters/utils/computeChatCost.ts`                                      | quantity, computeFixedCredits, ComputeChatCostOptions, unit, resolveQuantity, ...                      |
| `packages/model-runtime/src/core/usageConverters/utils/withUsageCost.ts`                                        | usage, options, pricing, withUsageCost                                                                 |
| `packages/openapi/src/controllers/agent.controller.ts`                                                          | queryAgents, c                                                                                         |
| `packages/prompts/src/prompts/userMemory/index.ts`                                                              | UserMemoryData                                                                                         |
| `packages/types/src/files/upload.ts`                                                                            | UploadFileItem                                                                                         |
| `packages/types/src/tool/builtin.ts`                                                                            | ExtendedHumanInterventionConfig                                                                        |
| `packages/types/src/userMemory/tools.ts`                                                                        | RetrieveMemoryResult                                                                                   |
| `scripts/countEnWord.ts`                                                                                        | traverseDirectory, ignoredFiles, dirPath, main, config, ...                                            |
| `scripts/i18nWorkflow/analyzeUnusedKeys.ts`                                                                     | obj, key, isProtectedKey, main, usedKeysCount, ...                                                     |
| `src/features/AgentMockDevtools/Timeline/EventRow.tsx`                                                          | previewOf, event                                                                                       |
| `src/features/AgentMockDevtools/hooks/useMockCases.ts`                                                          | useMockCases                                                                                           |
| `src/features/ChatInput/InputEditor/ActionTag/useInstalledSkillsAndTools.ts`                                    | useInstalledSkillsAndTools                                                                             |
| `src/features/ChatInput/InputEditor/useMentionCategories.tsx`                                                   | useMentionCategories                                                                                   |
| `src/features/DevPanel/RenderGallery/MessageList.tsx`                                                           | buildMessages, now, coerceContent, mode, value, ...                                                    |
| `src/features/DevPanel/RenderGallery/useDevtoolsEntries.ts`                                                     | ApiEntry                                                                                               |
| `src/features/Onboarding/Agent/NameSuggestions.tsx`                                                             | sampleSuggestions, excludeIds, count                                                                   |
| `src/features/ResourceManager/components/LibraryHierarchy/index.tsx`                                            | parentKey, level, walk                                                                                 |
| `src/routes/(main)/home/features/WelcomeText/index.tsx`                                                         | embeddedLinks, plain, renderWithLinks, LinkSpan                                                        |
| `src/routes/(main)/settings/hooks/useCategory.test.tsx`                                                         | key, useTranslation, t                                                                                 |
| `src/routes/(main)/settings/hooks/useCategory.tsx`                                                              | useCategory                                                                                            |
| `src/server/modules/AgentRuntime/StreamEventManager.ts`                                                         | lastEventId, operationId, onEvents, subscribeStreamEvents, signal                                      |
| `src/server/services/agentSignal/observability/projector.ts`                                                    | results, signals, buildTraceEdges, source, actions                                                     |
| `src/server/services/agentSignal/observability/types.ts`                                                        | AgentSignalTraceEdge                                                                                   |
| `src/server/services/agentSignal/policies/completionPolicy.test.ts`                                             | installAndCapture, middleware                                                                          |
| `src/server/services/agentSignal/services/selfIteration/completion/__test__/completionLoop.integration.test.ts` | makeInMemoryReceiptStore, middleware, installAndCapture                                                |
| `src/server/services/agentSignal/services/selfIteration/feedback/__test__/handler.test.ts`                      | handleSource, handler                                                                                  |
| `src/server/services/agentSignal/services/selfIteration/reflection/__test__/handler.test.ts`                    | handler, handler, handleSource, handleSource                                                           |
| `src/server/services/agentSignal/services/selfIteration/review/__test__/handler.test.ts`                        | handler, handleSource                                                                                  |
| `src/server/services/agentSignal/services/selfIteration/review/collect.ts`                                      | SelfReviewSignal                                                                                       |
| `src/server/services/agentSignal/services/selfIteration/review/signals.ts`                                      | deriveSelfReviewSignals, createFeedbackFeatures, feedbackActivity, DeriveSelfReviewSignalsInput, input |
| `src/server/services/bot/platforms/discord/client.ts`                                                           | message, extractFiles                                                                                  |
| `src/server/services/toolExecution/serverRuntimes/activator.ts`                                                 | identifiers, service.getToolManifests                                                                  |
| `src/services/chat/mecha/contextEngineering.ts`                                                                 | contextEngineering                                                                                     |
| `src/services/chat/mecha/memoryManager.ts`                                                                      | resolveUserPersona, resolveTopicMemories, ctx, combineUserMemoryData, topicMemories, ...               |
| `src/services/chat/mecha/skillEngineering.ts`                                                                   | pluginIds, resolveClientSkills                                                                         |
| `src/services/chat/mecha/skillPreload.ts`                                                                       | getAttr, name, attrs, extractSelectedSkillsFromText, text                                              |
| `src/services/chat/mecha/toolPreload.ts`                                                                        | text, extractSelectedToolsFromText                                                                     |
| `src/store/chat/agents/__tests__/createAgentExecutors/fixtures/mockMessages.ts`                                 | createAssistantMessage, messageCount, createUserMessage, overrides, overrides, ...                     |
| `src/store/chat/slices/aiChat/actions/__tests__/clientToolExecution.test.ts`                                    | resolver                                                                                               |
| `src/store/file/reducers/uploadFileList.test.ts`                                                                | createMockFile, id                                                                                     |
| `src/store/file/reducers/uploadFileList.ts`                                                                     | action, uploadFileListReducer, state, UploadFileListDispatch                                           |
| `src/store/tool/slices/builtin/executors/lobe-activator.ts`                                                     | service.getToolManifests, identifiers                                                                  |

## Entry Points

- `src/services/chat/mecha/contextEngineering.ts::contextEngineering`

## Connected Communities

- **local-file-shell/src · expandTilde** (2 cross-edges)
- **heterogeneous-agents/src · ClaudeCodeAdapter** (2 cross-edges)
- **services/selfIteration · pushUniqueRef** (2 cross-edges)
- **i18nWorkflow · removeKeyFromObject** (1 cross-edges)
- **src/types +1 dirs · computeLookupCredits** (1 cross-edges)
- **scripts/agent-gateway +1 dirs** (1 cross-edges)
- **src/audit +1 dirs** (1 cross-edges)
- **core/usageConverters** (1 cross-edges)
- **src/snapshot · appendLlmStep** (1 cross-edges)
- **src/spawn +7 dirs** (1 cross-edges)
- **src/tokenAccounting · estimateSentMessageAttachmentTo…** (1 cross-edges)
- **scripts · processValue** (1 cross-edges)
- **DevPanel/RenderGallery · deriveFixtureProps** (1 cross-edges)
- **agent-manager-runtime/src +1 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-1171"
smart_context with task: "understand src/transformation +60 dirs", format: "gcx"
find_usages with id: "src/services/chat/mecha/contextEngineering.ts::contextEngineering", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

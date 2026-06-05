---
name: gortex-types-src-29-dirs
description: 'Work in the types/src +29 dirs area — 156 symbols across 36 files (69% cohesion)'
---

# types/src +29 dirs

156 symbols | 36 files | 69% cohesion

## When to Use

Use this skill when working on files in:

- `packages/database/src/models/userMemory/model.ts`
- `packages/database/src/repositories/search/index.ts`
- `packages/database/src/type.ts`
- `packages/model-runtime/src/core/ModelRuntime.ts`
- `packages/model-runtime/src/providers/bedrock/index.ts`
- `packages/model-runtime/src/providers/ollama/index.ts`
- `packages/model-runtime/src/types/embeddings.ts`
- `packages/types/src/brief/index.ts`
- `packages/types/src/followUpAction.ts`
- `packages/types/src/knowledgeBase/index.ts`
- `packages/types/src/message/common/metadata.ts`
- `packages/types/src/rag.ts`
- `packages/types/src/user/settings/systemAgent.ts`
- `packages/types/src/userMemory/tools.ts`
- `src/business/server/getProviderContentPolicyErrorMessage.ts`
- `src/business/server/trackProviderContentPolicyViolation.ts`
- `src/libs/oidc-provider/access-control.ts`
- `src/server/globalConfig/index.ts`
- `src/server/globalConfig/parseFilesConfig.ts`
- `src/server/modules/ModelRuntime/index.ts`
- `src/server/routers/lambda/__tests__/integration/setup.ts`
- `src/server/routers/lambda/userMemories.ts`
- `src/server/services/agentDocumentVfs/mounts/skills/createSkillMount.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/feedbackDomainAgent.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts`
- `src/server/services/agentSignal/policies/types.ts`
- `src/server/services/aiGeneration/index.ts`
- `src/server/services/followUpAction/index.ts`
- `src/server/services/generation/videoBackgroundPolling.ts`
- `src/server/services/knowledgeBase/index.ts`
- `src/server/services/llmGenerationTracing/hook.ts`
- `src/server/services/systemAgent/index.ts`
- `src/server/services/systemAgent/modelConfig.ts`
- `src/server/services/taskLifecycle/index.ts`
- `src/server/services/taskLifecycle/synthesize.ts`
- `src/server/services/toolExecution/serverRuntimes/memory.ts`

## Key Files

| File                                                                             | Symbols                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/src/models/userMemory/model.ts`                               | db, isPGliteDatabase                                                                                                        |
| `packages/database/src/repositories/search/index.ts`                             | KnowledgeBaseDocumentHit                                                                                                    |
| `packages/database/src/type.ts`                                                  | LobeChatDatabase                                                                                                            |
| `packages/model-runtime/src/core/ModelRuntime.ts`                                | startedAt, generateObject, buildGenerateObjectSpeed, fireComplete, usage, ...                                               |
| `packages/model-runtime/src/providers/bedrock/index.ts`                          | options, embeddings, payload                                                                                                |
| `packages/model-runtime/src/providers/ollama/index.ts`                           | embeddings, payload                                                                                                         |
| `packages/model-runtime/src/types/embeddings.ts`                                 | EmbeddingsPayload, Embeddings                                                                                               |
| `packages/types/src/brief/index.ts`                                              | BriefType                                                                                                                   |
| `packages/types/src/followUpAction.ts`                                           | FollowUpExtractResult                                                                                                       |
| `packages/types/src/knowledgeBase/index.ts`                                      | SystemEmbeddingConfig                                                                                                       |
| `packages/types/src/message/common/metadata.ts`                                  | ModelPerformance                                                                                                            |
| `packages/types/src/rag.ts`                                                      | SemanticSearchSchemaType                                                                                                    |
| `packages/types/src/user/settings/systemAgent.ts`                                | UserSystemAgentConfigKey                                                                                                    |
| `packages/types/src/userMemory/tools.ts`                                         | SearchMemoryResult                                                                                                          |
| `src/business/server/getProviderContentPolicyErrorMessage.ts`                    | getProviderContentPolicyErrorMessage, \_params                                                                              |
| `src/business/server/trackProviderContentPolicyViolation.ts`                     | \_params, trackProviderContentPolicyViolation, TrackProviderContentPolicyViolationParams                                    |
| `src/libs/oidc-provider/access-control.ts`                                       | userId, revokeOIDCArtifactsByUserId, db                                                                                     |
| `src/server/globalConfig/index.ts`                                               | getServerDefaultFilesConfig                                                                                                 |
| `src/server/globalConfig/parseFilesConfig.ts`                                    | envString, parseFilesConfig                                                                                                 |
| `src/server/modules/ModelRuntime/index.ts`                                       | runtimeProvider, initModelRuntimeFromDB, buildPayloadFromKeyVaults, db, sdkType, ...                                        |
| `src/server/routers/lambda/__tests__/integration/setup.ts`                       | agentId, serverDB, userId, createTestAgent, serverDB, ...                                                                   |
| `src/server/routers/lambda/userMemories.ts`                                      | MemorySearchContext, applySearchLimitsByEffort, input, getEmbeddingRuntime, normalizeMemoryEffort, ...                      |
| `src/server/services/agentDocumentVfs/mounts/skills/createSkillMount.ts`         | createSkillMount, userId, db                                                                                                |
| `src/server/services/agentSignal/policies/analyzeIntent/feedbackDomainAgent.ts`  | targets, params, judgeDomains, FeedbackDomainJudgeAgentResult, JudgeFeedbackDomainsParams, ...                              |
| `src/server/services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts` | judgeSatisfaction, input, normalizeGenerateObjectMessages, JudgeFeedbackSatisfactionParams, classifier.classify, ...        |
| `src/server/services/agentSignal/policies/types.ts`                              | AgentSignalFeedbackSatisfactionStagePayload                                                                                 |
| `src/server/services/aiGeneration/index.ts`                                      | AiGenerationObjectInput, generateObject, options, AiGenerationObjectOptions, T, ...                                         |
| `src/server/services/followUpAction/index.ts`                                    | EMPTY_RESULT, extract, messageId                                                                                            |
| `src/server/services/generation/videoBackgroundPolling.ts`                       | sleep, pollUntilCompletion, BackgroundPollingParams, processBackgroundVideoPolling, modelRuntime, ...                       |
| `src/server/services/knowledgeBase/index.ts`                                     | semanticSearchForChat, vectorPath, bm25Path, input, groupAndRankFiles, ...                                                  |
| `src/server/services/llmGenerationTracing/hook.ts`                               | context, data, onGenerateObjectComplete                                                                                     |
| `src/server/services/systemAgent/index.ts`                                       | db, getUserLocale, SystemAgentService, constructor, db, ...                                                                 |
| `src/server/services/systemAgent/modelConfig.ts`                                 | resolveSystemAgentModelConfig                                                                                               |
| `src/server/services/taskLifecycle/index.ts`                                     | taskId, currentTask, taskId, taskIdentifier, taskIdentifier, ...                                                            |
| `src/server/services/taskLifecycle/synthesize.ts`                                | selectBriefType, ShouldEmitTopicBriefResult, ShouldEmitTopicBriefInput, isTrivialAssistantContent, selectBriefPriority, ... |
| `src/server/services/toolExecution/serverRuntimes/memory.ts`                     | getEmbeddingRuntime, userId, serverDB                                                                                       |

## Connected Communities

- **followUpAction/prompts** (1 cross-edges)
- **core/RouterRuntime +3 dirs** (1 cross-edges)
- **services/generation · processVideoForGeneration** (1 cross-edges)
- **policies/analyzeIntent · isGenerateObjectRole · feedbackDomainAgent** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4763"
smart_context with task: "understand types/src +29 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

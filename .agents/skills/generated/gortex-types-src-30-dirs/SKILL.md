---
name: gortex-types-src-30-dirs
description: 'Work in the types/src +30 dirs area — 159 symbols across 37 files (70% cohesion)'
---

# types/src +30 dirs

159 symbols | 37 files | 70% cohesion

## When to Use

Use this skill when working on files in:

- `packages/database/src/models/task.ts`
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

| File                                                                             | Symbols                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/database/src/models/task.ts`                                           | since, taskId, getDocumentsPinnedSince                                                      |
| `packages/database/src/models/userMemory/model.ts`                               | db, isPGliteDatabase                                                                        |
| `packages/database/src/repositories/search/index.ts`                             | KnowledgeBaseDocumentHit                                                                    |
| `packages/database/src/type.ts`                                                  | LobeChatDatabase                                                                            |
| `packages/model-runtime/src/core/ModelRuntime.ts`                                | usage, payload, startedAt, options, fireComplete, ...                                       |
| `packages/model-runtime/src/providers/bedrock/index.ts`                          | embeddings, options, payload                                                                |
| `packages/model-runtime/src/providers/ollama/index.ts`                           | payload, embeddings                                                                         |
| `packages/model-runtime/src/types/embeddings.ts`                                 | Embeddings, EmbeddingsPayload                                                               |
| `packages/types/src/brief/index.ts`                                              | BriefType                                                                                   |
| `packages/types/src/followUpAction.ts`                                           | FollowUpExtractResult                                                                       |
| `packages/types/src/knowledgeBase/index.ts`                                      | SystemEmbeddingConfig                                                                       |
| `packages/types/src/message/common/metadata.ts`                                  | ModelPerformance                                                                            |
| `packages/types/src/rag.ts`                                                      | SemanticSearchSchemaType                                                                    |
| `packages/types/src/user/settings/systemAgent.ts`                                | UserSystemAgentConfigKey                                                                    |
| `packages/types/src/userMemory/tools.ts`                                         | SearchMemoryResult                                                                          |
| `src/business/server/getProviderContentPolicyErrorMessage.ts`                    | getProviderContentPolicyErrorMessage, \_params                                              |
| `src/business/server/trackProviderContentPolicyViolation.ts`                     | trackProviderContentPolicyViolation, TrackProviderContentPolicyViolationParams, \_params    |
| `src/libs/oidc-provider/access-control.ts`                                       | db, revokeOIDCArtifactsByUserId, userId                                                     |
| `src/server/globalConfig/index.ts`                                               | getServerDefaultFilesConfig                                                                 |
| `src/server/globalConfig/parseFilesConfig.ts`                                    | envString, parseFilesConfig                                                                 |
| `src/server/modules/ModelRuntime/index.ts`                                       | runtimeProvider, userId, initModelRuntimeFromDB, resolveRuntimeProvider, provider, ...      |
| `src/server/routers/lambda/__tests__/integration/setup.ts`                       | createTestUser, topicId, createTestTopic, serverDB, createTestAgent, ...                    |
| `src/server/routers/lambda/userMemories.ts`                                      | effort, ctx, MemorySearchContext, value, input, ...                                         |
| `src/server/services/agentDocumentVfs/mounts/skills/createSkillMount.ts`         | db, createSkillMount, userId                                                                |
| `src/server/services/agentSignal/policies/analyzeIntent/feedbackDomainAgent.ts`  | dedupeTargets, JudgeFeedbackDomainsParams, judgeDomains, targets, params, ...               |
| `src/server/services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts` | input, JudgeFeedbackSatisfactionParams, params, classifier.classify, judgeSatisfaction, ... |
| `src/server/services/agentSignal/policies/types.ts`                              | AgentSignalFeedbackSatisfactionStagePayload                                                 |
| `src/server/services/aiGeneration/index.ts`                                      | input, AiGenerationObjectOptions, generateObject, options, T, ...                           |
| `src/server/services/followUpAction/index.ts`                                    | extract, messageId, EMPTY_RESULT                                                            |
| `src/server/services/generation/videoBackgroundPolling.ts`                       | BackgroundPollingParams, processBackgroundVideoPolling, sleep, db, inferenceId, ...         |
| `src/server/services/knowledgeBase/index.ts`                                     | chunks, vectorPath, bm25Path, topK, semanticSearchForChat, ...                              |
| `src/server/services/llmGenerationTracing/hook.ts`                               | context, data, onGenerateObjectComplete                                                     |
| `src/server/services/systemAgent/index.ts`                                       | db, taskKey, constructor, params, SystemAgentService, ...                                   |
| `src/server/services/systemAgent/modelConfig.ts`                                 | resolveSystemAgentModelConfig                                                               |
| `src/server/services/taskLifecycle/index.ts`                                     | topicId, taskIdentifier, synthesizeTopicBrief, taskId, taskIdentifier, ...                  |
| `src/server/services/taskLifecycle/synthesize.ts`                                | content, input, ShouldEmitTopicBriefResult, \_input, selectBriefType, ...                   |
| `src/server/services/toolExecution/serverRuntimes/memory.ts`                     | userId, getEmbeddingRuntime, serverDB                                                       |

## Connected Communities

- **services/generation · processVideoForGeneration** (1 cross-edges)
- **policies/analyzeIntent · isGenerateObjectRole · feedbackDomainAgent** (1 cross-edges)
- **followUpAction/prompts** (1 cross-edges)
- **types/src +1 dirs · initModelRuntimeWithUserPayload** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4765"
smart_context with task: "understand types/src +30 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

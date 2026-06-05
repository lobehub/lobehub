---
name: gortex-providers-tests-7-dirs
description: 'Work in the providers/__tests__ +7 dirs area — 241 symbols across 59 files (90% cohesion)'
---

# providers/**tests** +7 dirs

241 symbols | 59 files | 90% cohesion

## When to Use

Use this skill when working on files in:

- `packages/context-engine/src/base/__tests__/BaseEveryUserContentProvider.test.ts`
- `packages/context-engine/src/base/__tests__/BaseFirstUserContentProvider.test.ts`
- `packages/context-engine/src/base/__tests__/BaseLastUserContentProvider.test.ts`
- `packages/context-engine/src/base/__tests__/BaseProcessor.test.ts`
- `packages/context-engine/src/base/__tests__/BaseProvider.test.ts`
- `packages/context-engine/src/base/__tests__/BaseSystemRoleProvider.test.ts`
- `packages/context-engine/src/base/__tests__/BaseVirtualLastUserContentProvider.test.ts`
- `packages/context-engine/src/processors/CompressedGroupRoleTransform.ts`
- `packages/context-engine/src/processors/GroupMessageFlatten.ts`
- `packages/context-engine/src/processors/InputTemplate.ts`
- `packages/context-engine/src/processors/ReactionFeedback.ts`
- `packages/context-engine/src/processors/SupervisorRoleRestore.ts`
- `packages/context-engine/src/processors/TasksFlatten.ts`
- `packages/context-engine/src/processors/__tests__/AgentCouncilFlatten.test.ts`
- `packages/context-engine/src/processors/__tests__/GroupMessageFlatten.test.ts`
- `packages/context-engine/src/processors/__tests__/GroupOrchestrationFilter.test.ts`
- `packages/context-engine/src/processors/__tests__/GroupRoleTransform.test.ts`
- `packages/context-engine/src/processors/__tests__/MessageCleanup.test.ts`
- `packages/context-engine/src/processors/__tests__/PlaceholderVariables.toolMessage.test.ts`
- `packages/context-engine/src/processors/__tests__/SupervisorRoleRestore.test.ts`
- `packages/context-engine/src/processors/__tests__/TaskMessage.test.ts`
- `packages/context-engine/src/processors/__tests__/ToolCall.test.ts`
- `packages/context-engine/src/processors/__tests__/ToolMessageReorder.test.ts`
- `packages/context-engine/src/providers/ActiveTopicDocumentContextInjector.ts`
- `packages/context-engine/src/providers/AgentBuilderContextInjector.ts`
- `packages/context-engine/src/providers/AgentManagementContextInjector.ts`
- `packages/context-engine/src/providers/ForceFinishSummaryInjector.ts`
- `packages/context-engine/src/providers/GroupAgentBuilderContextInjector.ts`
- `packages/context-engine/src/providers/GroupContextInjector.ts`
- `packages/context-engine/src/providers/KnowledgeInjector.ts`
- `packages/context-engine/src/providers/OnboardingActionHintInjector.ts`
- `packages/context-engine/src/providers/PageEditorContextInjector.ts`
- `packages/context-engine/src/providers/PlanInjector.ts`
- `packages/context-engine/src/providers/TaskManagerContextInjector.ts`
- `packages/context-engine/src/providers/TodoInjector.ts`
- `packages/context-engine/src/providers/ToolDiscoveryProvider.ts`
- `packages/context-engine/src/providers/UserMemoryInjector.ts`
- `packages/context-engine/src/providers/__tests__/AgentBuilderContextInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/AgentDocumentInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/AgentManagementContextInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/DiscordContextProvider.test.ts`
- `packages/context-engine/src/providers/__tests__/GroupAgentBuilderContextInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/GroupContextInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/HistorySummaryProvider.test.ts`
- `packages/context-engine/src/providers/__tests__/KnowledgeInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/LocalSystemToolSnapshotInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/OnboardingActionHintInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/OnboardingContextInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/PageEditorContextInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/PageSelectionsInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/SelectedSkillInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/SelectedToolInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/SkillContextProvider.test.ts`
- `packages/context-engine/src/providers/__tests__/ToolSystemRoleProvider.test.ts`
- `packages/context-engine/src/providers/__tests__/TopicReferenceContextInjector.test.ts`
- `packages/context-engine/src/providers/__tests__/UserMemoryInjector.test.ts`
- `packages/context-engine/src/types.ts`
- `packages/memory-user-memory/src/types.ts`
- `packages/types/src/stepContext.ts`

## Key Files

| File                                                                                        | Symbols                                                               |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/context-engine/src/base/__tests__/BaseEveryUserContentProvider.test.ts`           | messages, createContext                                               |
| `packages/context-engine/src/base/__tests__/BaseFirstUserContentProvider.test.ts`           | messages, createContext                                               |
| `packages/context-engine/src/base/__tests__/BaseLastUserContentProvider.test.ts`            | messages, doProcess, doProcess, name, name, ...                       |
| `packages/context-engine/src/base/__tests__/BaseProcessor.test.ts`                          | name, name, context, name, name, ...                                  |
| `packages/context-engine/src/base/__tests__/BaseProvider.test.ts`                           | context, doProcess, context, name, doProcess, ...                     |
| `packages/context-engine/src/base/__tests__/BaseSystemRoleProvider.test.ts`                 | createContext, messages                                               |
| `packages/context-engine/src/base/__tests__/BaseVirtualLastUserContentProvider.test.ts`     | messages, createContext                                               |
| `packages/context-engine/src/processors/CompressedGroupRoleTransform.ts`                    | doProcess, context                                                    |
| `packages/context-engine/src/processors/GroupMessageFlatten.ts`                             | context, doProcess                                                    |
| `packages/context-engine/src/processors/InputTemplate.ts`                                   | context, doProcess                                                    |
| `packages/context-engine/src/processors/ReactionFeedback.ts`                                | doProcess, context                                                    |
| `packages/context-engine/src/processors/SupervisorRoleRestore.ts`                           | doProcess, context                                                    |
| `packages/context-engine/src/processors/TasksFlatten.ts`                                    | doProcess, context                                                    |
| `packages/context-engine/src/processors/__tests__/AgentCouncilFlatten.test.ts`              | messages, createContext                                               |
| `packages/context-engine/src/processors/__tests__/GroupMessageFlatten.test.ts`              | createContext, messages                                               |
| `packages/context-engine/src/processors/__tests__/GroupOrchestrationFilter.test.ts`         | createContext, messages                                               |
| `packages/context-engine/src/processors/__tests__/GroupRoleTransform.test.ts`               | messages, createContext                                               |
| `packages/context-engine/src/processors/__tests__/MessageCleanup.test.ts`                   | createContext, messages                                               |
| `packages/context-engine/src/processors/__tests__/PlaceholderVariables.toolMessage.test.ts` | messages, buildContext                                                |
| `packages/context-engine/src/processors/__tests__/SupervisorRoleRestore.test.ts`            | createContext, messages                                               |
| `packages/context-engine/src/processors/__tests__/TaskMessage.test.ts`                      | createContext, messages                                               |
| `packages/context-engine/src/processors/__tests__/ToolCall.test.ts`                         | messages, createContext                                               |
| `packages/context-engine/src/processors/__tests__/ToolMessageReorder.test.ts`               | createContext, messages                                               |
| `packages/context-engine/src/providers/ActiveTopicDocumentContextInjector.ts`               | doProcess, context, formatActiveTopicDocumentContext, document        |
| `packages/context-engine/src/providers/AgentBuilderContextInjector.ts`                      | context, doProcess                                                    |
| `packages/context-engine/src/providers/AgentManagementContextInjector.ts`                   | doProcess, mentionedAgents, context, formatMentionedAgentsContext     |
| `packages/context-engine/src/providers/ForceFinishSummaryInjector.ts`                       | context, doProcess                                                    |
| `packages/context-engine/src/providers/GroupAgentBuilderContextInjector.ts`                 | context, doProcess                                                    |
| `packages/context-engine/src/providers/GroupContextInjector.ts`                             | context, doProcess                                                    |
| `packages/context-engine/src/providers/KnowledgeInjector.ts`                                | doProcess, context                                                    |
| `packages/context-engine/src/providers/OnboardingActionHintInjector.ts`                     | shouldSkip, context, context, buildDiscoveryTurnReminder, config, ... |
| `packages/context-engine/src/providers/PageEditorContextInjector.ts`                        | context, doProcess                                                    |
| `packages/context-engine/src/providers/PlanInjector.ts`                                     | doProcess, context                                                    |
| `packages/context-engine/src/providers/TaskManagerContextInjector.ts`                       | doProcess, context                                                    |
| `packages/context-engine/src/providers/TodoInjector.ts`                                     | doProcess, formatTodos, todos, TodoList, context                      |
| `packages/context-engine/src/providers/ToolDiscoveryProvider.ts`                            | doProcess, context                                                    |
| `packages/context-engine/src/providers/UserMemoryInjector.ts`                               | doProcess, context                                                    |
| `packages/context-engine/src/providers/__tests__/AgentBuilderContextInjector.test.ts`       | createContext                                                         |
| `packages/context-engine/src/providers/__tests__/AgentDocumentInjector.test.ts`             | createContext, messages                                               |
| `packages/context-engine/src/providers/__tests__/AgentManagementContextInjector.test.ts`    | createContext, messages                                               |
| `packages/context-engine/src/providers/__tests__/DiscordContextProvider.test.ts`            | createContext, index, getInjectedContent, messages, result            |
| `packages/context-engine/src/providers/__tests__/GroupAgentBuilderContextInjector.test.ts`  | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/GroupContextInjector.test.ts`              | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/HistorySummaryProvider.test.ts`            | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/KnowledgeInjector.test.ts`                 | createContext, messages                                               |
| `packages/context-engine/src/providers/__tests__/LocalSystemToolSnapshotInjector.test.ts`   | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/OnboardingActionHintInjector.test.ts`      | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/OnboardingContextInjector.test.ts`         | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/PageEditorContextInjector.test.ts`         | createContext, messages                                               |
| `packages/context-engine/src/providers/__tests__/PageSelectionsInjector.test.ts`            | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/SelectedSkillInjector.test.ts`             | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/SelectedToolInjector.test.ts`              | createContext, messages                                               |
| `packages/context-engine/src/providers/__tests__/SkillContextProvider.test.ts`              | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/ToolSystemRoleProvider.test.ts`            | createContext, messages                                               |
| `packages/context-engine/src/providers/__tests__/TopicReferenceContextInjector.test.ts`     | messages, createContext                                               |
| `packages/context-engine/src/providers/__tests__/UserMemoryInjector.test.ts`                | messages, createContext                                               |
| `packages/context-engine/src/types.ts`                                                      | PipelineContext                                                       |
| `packages/memory-user-memory/src/types.ts`                                                  | MemoryContextProvider                                                 |
| `packages/types/src/stepContext.ts`                                                         | RuntimeActiveTopicDocumentContext                                     |

## How to Explore

```
get_communities with id: "community-781"
smart_context with task: "understand providers/__tests__ +7 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

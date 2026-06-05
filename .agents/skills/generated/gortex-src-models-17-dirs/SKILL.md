---
name: gortex-src-models-17-dirs
description: 'Work in the src/models +17 dirs area — 277 symbols across 34 files (81% cohesion)'
---

# src/models +17 dirs

277 symbols | 34 files | 81% cohesion

## When to Use

Use this skill when working on files in:

- `packages/agent-templates/src/types.ts`
- `packages/database/src/models/__tests__/topics/topicUsage.test.ts`
- `packages/database/src/models/agentCronJob.ts`
- `packages/database/src/models/agentDocuments/agentDocument.ts`
- `packages/database/src/models/agentDocuments/deriveFields.ts`
- `packages/database/src/models/agentDocuments/filename.ts`
- `packages/database/src/models/agentDocuments/policy/loadRule.ts`
- `packages/database/src/models/agentDocuments/policy/policy.ts`
- `packages/database/src/models/agentDocuments/types.ts`
- `packages/database/src/models/agentOperation.ts`
- `packages/database/src/models/brief.ts`
- `packages/database/src/models/chatGroup.ts`
- `packages/database/src/models/llmGenerationTracing.ts`
- `packages/database/src/models/notification.ts`
- `packages/database/src/models/task.ts`
- `packages/database/src/models/taskTopic.ts`
- `packages/database/src/models/topic.ts`
- `packages/database/src/repositories/agentGroup/index.ts`
- `packages/database/src/repositories/compression/index.ts`
- `packages/database/src/repositories/userMemory/UserMemoryTopicRepository.ts`
- `packages/database/src/schemas/agentCronJob.ts`
- `packages/database/src/schemas/task.ts`
- `packages/memory-user-memory/src/providers/chatTopic.ts`
- `packages/openapi/src/services/role.service.ts`
- `packages/openapi/src/services/user.service.ts`
- `src/server/routers/lambda/__tests__/integration/agentSkills.integration.test.ts`
- `src/server/routers/lambda/__tests__/integration/setup.ts`
- `src/server/routers/lambda/__tests__/integration/task.integration.test.ts`
- `src/server/routers/lambda/_helpers/resolveContext.ts`
- `src/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils.ts`
- `src/server/services/agentDocuments/index.ts`
- `src/server/services/push/__tests__/processPushReceipts.test.ts`
- `src/server/services/toolExecution/serverRuntimes/message/index.ts`
- `src/utils/__tests__/agentDocumentContextMapping.test.ts`

## Key Files

| File                                                                                               | Symbols                                                                               |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/agent-templates/src/types.ts`                                                            | BEFORE_FIRST_USER, DocumentLoadRules, SYSTEM_APPEND, ON_DEMAND, AFTER_FIRST_USER, ... |
| `packages/database/src/models/__tests__/topics/topicUsage.test.ts`                                 | id, getTopic                                                                          |
| `packages/database/src/models/agentCronJob.ts`                                                     | agentId, findByStatus, countByAgentId, constructor, getTasksNearDepletion, ...        |
| `packages/database/src/models/agentDocuments/agentDocument.ts`                                     | agentId, agentId, parentIds, parentId, params, ...                                    |
| `packages/database/src/models/agentDocuments/deriveFields.ts`                                      | doc, deriveAgentDocumentFields                                                        |
| `packages/database/src/models/agentDocuments/filename.ts`                                          | title, buildDocumentFilename, sanitizeDocumentFilename, value                         |
| `packages/database/src/models/agentDocuments/policy/loadRule.ts`                                   | doc, sortByLoadRulePriority, resolveDocumentLoadPosition, parseLoadRules, doc, ...    |
| `packages/database/src/models/agentDocuments/policy/policy.ts`                                     | policy, normalizePolicy, loadRules, loadPosition                                      |
| `packages/database/src/models/agentDocuments/types.ts`                                             | AgentDocumentWithRules, AgentDocumentDerivedFields                                    |
| `packages/database/src/models/agentOperation.ts`                                                   | getMaxDurationSeconds                                                                 |
| `packages/database/src/models/brief.ts`                                                            | cronJobId, findByCronJobId                                                            |
| `packages/database/src/models/chatGroup.ts`                                                        | groupId, removeAgentsFromGroup, agentIds, agentId, removeAgentFromGroup, ...          |
| `packages/database/src/models/llmGenerationTracing.ts`                                             | listRecent, limit                                                                     |
| `packages/database/src/models/notification.ts`                                                     | getUnreadCount                                                                        |
| `packages/database/src/models/task.ts`                                                             | data, list, taskId, parentTaskId, options, ...                                        |
| `packages/database/src/models/taskTopic.ts`                                                        | findByTaskId, taskId, findWithHandoff, limit, findWithDetails, ...                    |
| `packages/database/src/models/topic.ts`                                                            | fields, orderBy                                                                       |
| `packages/database/src/repositories/agentGroup/index.ts`                                           | findByIdWithAgents, groupId                                                           |
| `packages/database/src/repositories/compression/index.ts`                                          | unmarkMessagesFromCompression, messageIds, pinned, toggleMessagePin, messageId        |
| `packages/database/src/repositories/userMemory/UserMemoryTopicRepository.ts`                       | getUserMessagesQueryForTopic, topicId                                                 |
| `packages/database/src/schemas/agentCronJob.ts`                                                    | CreateAgentCronJobData, AgentCronJob                                                  |
| `packages/database/src/schemas/task.ts`                                                            | TaskTopicItem                                                                         |
| `packages/memory-user-memory/src/providers/chatTopic.ts`                                           | recordComplete, job, result                                                           |
| `packages/openapi/src/services/role.service.ts`                                                    | roleId, clearRolePermissions                                                          |
| `packages/openapi/src/services/user.service.ts`                                                    | getUserRoles, userId, userId, userId, clearUserRoles, ...                             |
| `src/server/routers/lambda/__tests__/integration/agentSkills.integration.test.ts`                  | getManagedSkillBindingId                                                              |
| `src/server/routers/lambda/__tests__/integration/setup.ts`                                         | userId, serverDB, cleanupTestUser                                                     |
| `src/server/routers/lambda/__tests__/integration/task.integration.test.ts`                         | provider, model, setAgentModel                                                        |
| `src/server/routers/lambda/_helpers/resolveContext.ts`                                             | db, batchResolveAgentIdFromSessions, userId, sessionIds                               |
| `src/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils.ts` | AgentSkillDocumentModelLike                                                           |
| `src/server/services/agentDocuments/index.ts`                                                      | agentId, getDocumentsByPolicy, policyId, templateId, getDocumentsByTemplate, ...      |
| `src/server/services/push/__tests__/processPushReceipts.test.ts`                                   | where                                                                                 |
| `src/server/services/toolExecution/serverRuntimes/message/index.ts`                                | botProvider.listBots                                                                  |
| `src/utils/__tests__/agentDocumentContextMapping.test.ts`                                          | buildDoc, overrides                                                                   |

## Connected Communities

- **src/models +11 dirs** (2 cross-edges)
- **agent-templates/src +1 dirs** (1 cross-edges)
- **models/agentDocuments · deriveCategory** (1 cross-edges)
- **agent-templates/src +2 dirs** (1 cross-edges)
- **src/transformation +60 dirs** (1 cross-edges)
- **services/agentDocuments · getDocumentsByPosition** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-888"
smart_context with task: "understand src/models +17 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

---
name: gortex-services-agentdocuments-6-dirs
description: 'Work in the services/agentDocuments +6 dirs area — 117 symbols across 10 files (82% cohesion)'
---

# services/agentDocuments +6 dirs

117 symbols | 10 files | 82% cohesion

## When to Use

Use this skill when working on files in:

- `packages/builtin-tool-web-browsing/src/ExecutionRuntime/index.ts`
- `packages/database/src/models/task.ts`
- `src/server/routers/lambda/__tests__/agentDocument.toolOutcome.test.ts`
- `src/server/routers/lambda/user.ts`
- `src/server/services/agentDocuments/headlessEditor.ts`
- `src/server/services/agentDocuments/index.ts`
- `src/server/services/document/index.ts`
- `src/server/services/document/types.ts`
- `src/server/services/toolExecution/serverRuntimes/agentDocuments.ts`
- `src/server/services/toolExecution/serverRuntimes/webOnboarding.ts`

## Key Files

| File                                                                    | Symbols                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/builtin-tool-web-browsing/src/ExecutionRuntime/index.ts`      | WebBrowsingDocumentService                                                                                   |
| `packages/database/src/models/task.ts`                                  | pinnedBy, pinDocument, documentId, taskId                                                                    |
| `src/server/routers/lambda/__tests__/agentDocument.toolOutcome.test.ts` | MockAgentDocumentsService                                                                                    |
| `src/server/routers/lambda/user.ts`                                     | readCurrent                                                                                                  |
| `src/server/services/agentDocuments/headlessEditor.ts`                  | operations, orderLiteXMLOperations, content, hydrateMarkdownOrEmptyState, AgentDocumentLiteXMLOperation, ... |
| `src/server/services/agentDocuments/index.ts`                           | T, newTitle, expectedAgentId, expectedAgentId, documentId, ...                                               |
| `src/server/services/document/index.ts`                                 | trySaveCurrentDocumentHistory, documentId, saveSource                                                        |
| `src/server/services/document/types.ts`                                 | DocumentHistorySaveSource                                                                                    |
| `src/server/services/toolExecution/serverRuntimes/agentDocuments.ts`    | withDocumentOutcome, copyDocument, T, input, T, ...                                                          |
| `src/server/services/toolExecution/serverRuntimes/webOnboarding.ts`     | type, context, readDocument, saveUserQuestion, input, ...                                                    |

## Connected Communities

- **models/agentDocuments +2 dirs** (2 cross-edges)
- **server/services · renameSkill** (2 cross-edges)
- **server · emitToolOutcomeSafely** (1 cross-edges)
- **services/agentDocuments · getAgentDocuments** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4007"
smart_context with task: "understand services/agentDocuments +6 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

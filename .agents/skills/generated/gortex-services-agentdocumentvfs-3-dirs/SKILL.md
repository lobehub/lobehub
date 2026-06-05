---
name: gortex-services-agentdocumentvfs-3-dirs
description: 'Work in the services/agentDocumentVfs +3 dirs area — 153 symbols across 5 files (85% cohesion)'
---

# services/agentDocumentVfs +3 dirs

153 symbols | 5 files | 85% cohesion

## When to Use

Use this skill when working on files in:

- `apps/desktop/src/main/modules/cliEmbedding/generateCliWrapper.ts`
- `packages/database/src/models/agentDocuments/types.ts`
- `src/server/services/agentDocumentVfs/index.ts`
- `src/server/services/agentDocumentVfs/types.ts`
- `src/server/services/toolExecution/archiveToolResult.ts`

## Key Files

| File                                                               | Symbols                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/modules/cliEmbedding/generateCliWrapper.ts` | atomicWrite, resolveElectronBinary, generateCliWrapper, resolveCliScript, filePath, ...              |
| `packages/database/src/models/agentDocuments/types.ts`             | AgentDocument                                                                                        |
| `src/server/services/agentDocumentVfs/index.ts`                    | compareAgentDocumentAge, path, ctx, ctx, agentDocumentId, ...                                        |
| `src/server/services/agentDocumentVfs/types.ts`                    | AgentDocumentTrashEntry, AgentDocumentStats, AgentDocumentReadResult, AgentDocumentReadOptions       |
| `src/server/services/toolExecution/archiveToolResult.ts`           | archiveToolResultIfNeeded, buildArchivePath, ToolResultArchiveOutcome, getErrorMessage, topicId, ... |

## Connected Communities

- **services/agentDocumentVfs · createSyntheticDirectoryNode** (3 cross-edges)
- **server/services · renameSkill** (2 cross-edges)
- **src/transformation +60 dirs** (2 cross-edges)
- **services/agentDocumentVfs · resolveReadablePath** (2 cross-edges)
- **providers/github +51 dirs** (1 cross-edges)
- **src/main · App** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-3986"
smart_context with task: "understand services/agentDocumentVfs +3 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

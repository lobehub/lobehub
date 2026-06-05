---
name: gortex-services-skillmanagement-2-dirs
description: 'Work in the services/skillManagement +2 dirs area — 121 symbols across 7 files (91% cohesion)'
---

# services/skillManagement +2 dirs

121 symbols | 7 files | 91% cohesion

## When to Use

Use this skill when working on files in:

- `src/server/services/agentDocuments/headlessEditor.ts`
- `src/server/services/agentDocuments/index.ts`
- `src/server/services/skillManagement/SkillManagementDocumentService.test.ts`
- `src/server/services/skillManagement/SkillManagementDocumentService.ts`
- `src/server/services/skillManagement/frontmatter.ts`
- `src/server/services/skillManagement/types.ts`
- `src/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor.ts`

## Key Files

| File                                                                         | Symbols                                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/server/services/agentDocuments/headlessEditor.ts`                       | createMarkdownEditorSnapshot, content                                                                |
| `src/server/services/agentDocuments/index.ts`                                | agentId, createWithUniqueFilename, params, suffix, appendFilenameSuffix, ...                         |
| `src/server/services/skillManagement/SkillManagementDocumentService.test.ts` | params, params, findByDocumentId, update, filename, ...                                              |
| `src/server/services/skillManagement/SkillManagementDocumentService.ts`      | toDocumentRef, bundle, agentDocumentModel, resolveBundle, db, ...                                    |
| `src/server/services/skillManagement/frontmatter.ts`                         | SkillFrontmatter, renderSkillIndexContent, content, normalizeSkillIndexContent, value, ...           |
| `src/server/services/skillManagement/types.ts`                               | ReplaceSkillIndexInput, ListSkillsInput, SkillAgentDocument, RenameSkillInput, SkillDocumentRef, ... |
| `src/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor.ts`         | SubagentStoreDispatcher                                                                              |

## Connected Communities

- **services/agentDocuments +6 dirs** (4 cross-edges)

## How to Explore

```
get_communities with id: "community-4757"
smart_context with task: "understand services/skillManagement +2 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

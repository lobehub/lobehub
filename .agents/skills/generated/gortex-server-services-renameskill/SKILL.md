---
name: gortex-server-services-renameskill
description: 'Work in the server/services · renameSkill area — 120 symbols across 6 files (92% cohesion)'
---

# server/services · renameSkill

120 symbols | 6 files | 92% cohesion

## When to Use

Use this skill when working on files in:

- `src/server/services/agentDocuments/headlessEditor.ts`
- `src/server/services/agentDocuments/index.ts`
- `src/server/services/skillManagement/SkillManagementDocumentService.test.ts`
- `src/server/services/skillManagement/SkillManagementDocumentService.ts`
- `src/server/services/skillManagement/frontmatter.ts`
- `src/server/services/skillManagement/types.ts`

## Key Files

| File                                                                         | Symbols                                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/server/services/agentDocuments/headlessEditor.ts`                       | createMarkdownEditorSnapshot, content                                                         |
| `src/server/services/agentDocuments/index.ts`                                | title, content, filename, suffix, createWithUniqueFilename, ...                               |
| `src/server/services/skillManagement/SkillManagementDocumentService.test.ts` | listByParentAndFilename, agentId, params, createWithTx, documents, ...                        |
| `src/server/services/skillManagement/SkillManagementDocumentService.ts`      | agentDocumentModel, target, createMarkdownEditorSnapshot, input, readSkillTargetSnapshot, ... |
| `src/server/services/skillManagement/frontmatter.ts`                         | field, data, normalizeFrontmatterScalar, input, parseSkillFrontmatter, ...                    |
| `src/server/services/skillManagement/types.ts`                               | SkillSummary, SkillDetail, ListSkillsInput, SkillDocumentRef, CreateSkillInput, ...           |

## Connected Communities

- **services/agentDocuments +6 dirs** (4 cross-edges)

## How to Explore

```
get_communities with id: "community-4755"
smart_context with task: "understand server/services · renameSkill", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

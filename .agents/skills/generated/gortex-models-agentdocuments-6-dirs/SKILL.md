---
name: gortex-models-agentdocuments-6-dirs
description: 'Work in the models/agentDocuments +6 dirs area — 185 symbols across 11 files (88% cohesion)'
---

# models/agentDocuments +6 dirs

185 symbols | 11 files | 88% cohesion

## When to Use

Use this skill when working on files in:

- `packages/agent-templates/src/types.ts`
- `packages/database/src/models/agentDocuments/agentDocument.ts`
- `packages/database/src/models/agentDocuments/deriveFields.ts`
- `packages/database/src/models/agentDocuments/filename.ts`
- `packages/database/src/models/agentDocuments/policy/loadRule.ts`
- `packages/database/src/models/agentDocuments/policy/policy.ts`
- `packages/database/src/models/agentDocuments/types.ts`
- `src/server/routers/lambda/__tests__/integration/agentSkills.integration.test.ts`
- `src/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils.ts`
- `src/server/services/agentDocuments/index.ts`
- `src/utils/__tests__/agentDocumentContextMapping.test.ts`

## Key Files

| File                                                                                               | Symbols                                                                                      |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/agent-templates/src/types.ts`                                                            | AFTER_FIRST_USER, CONTEXT_END, DocumentLoadPosition, DocumentLoadRules, AFTER_KNOWLEDGE, ... |
| `packages/database/src/models/agentDocuments/agentDocument.ts`                                     | getInjectableDocuments, agentId, documentId, normalizeListOffset, buildDeletedAtFilters, ... |
| `packages/database/src/models/agentDocuments/deriveFields.ts`                                      | doc, deriveAgentDocumentFields                                                               |
| `packages/database/src/models/agentDocuments/filename.ts`                                          | sanitizeDocumentFilename, value, buildDocumentFilename, title                                |
| `packages/database/src/models/agentDocuments/policy/loadRule.ts`                                   | docs, parseLoadRules, sortByLoadRulePriority, doc, doc, ...                                  |
| `packages/database/src/models/agentDocuments/policy/policy.ts`                                     | loadRules, normalizePolicy, loadPosition, policy                                             |
| `packages/database/src/models/agentDocuments/types.ts`                                             | AgentDocumentWithRules, AgentDocumentDerivedFields                                           |
| `src/server/routers/lambda/__tests__/integration/agentSkills.integration.test.ts`                  | getManagedSkillBindingId                                                                     |
| `src/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils.ts` | AgentSkillDocumentModelLike                                                                  |
| `src/server/services/agentDocuments/index.ts`                                                      | policyId, getDocumentsByPolicy, templateId, agentId, getDocumentsByTemplate, ...             |
| `src/utils/__tests__/agentDocumentContextMapping.test.ts`                                          | buildDoc, overrides                                                                          |

## Connected Communities

- **models/agentDocuments · deriveCategory** (1 cross-edges)
- **agent-templates/src +2 dirs** (1 cross-edges)
- **services/agentDocuments · getDocumentsByPosition** (1 cross-edges)
- **agent-templates/src +1 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-883"
smart_context with task: "understand models/agentDocuments +6 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

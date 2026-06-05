---
name: gortex-global-selectors-2-dirs
description: 'Work in the global/selectors +2 dirs area — 122 symbols across 5 files (100% cohesion)'
---

# global/selectors +2 dirs

122 symbols | 5 files | 100% cohesion

## When to Use

Use this skill when working on files in:

- `src/features/Electron/titlebar/NavigationBar.tsx`
- `src/store/global/initialState.ts`
- `src/store/global/selectors/clientDB.ts`
- `src/store/global/selectors/general.ts`
- `src/store/global/selectors/systemStatus.ts`

## Key Files

| File                                               | Symbols                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/features/Electron/titlebar/NavigationBar.tsx` | navPanelSelector, s                                                           |
| `src/store/global/initialState.ts`                 | GlobalState, ModelDetailPanelExpandedKey                                      |
| `src/store/global/selectors/clientDB.ts`           | initClientDBMigrationSqls, s, errorMigrations, displayMigrationStatus, s, ... |
| `src/store/global/selectors/general.ts`            | language, s, s, currentLanguage                                               |
| `src/store/global/selectors/systemStatus.ts`       | mobileShowPortal, s, taskKanbanHiddenColumns, s, s, ...                       |

## How to Explore

```
get_communities with id: "community-5580"
smart_context with task: "understand global/selectors +2 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._

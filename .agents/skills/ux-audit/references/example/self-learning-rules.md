# UX Audit — All expertise rules

**Layers:** L1 ✅ · L2 desktop dark ✅ · L3 list → detail ✅.

## Patterns in use

| Pattern                    | Rating | Evidence                                                               |
| -------------------------- | ------ | ---------------------------------------------------------------------- |
| Breadcrumbs / Deep-linking | ✅     | Domain → all rules → rule has stable routes.                           |
| Overview + Detail          | ✅     | Every row is a semantic Link.                                          |
| Titled Sections            | ⚠️     | Page “全部经验” and inner “经验” repeat hierarchy.                     |
| Dynamic Query              | ⚠️     | Tier exists; service search/layer are not exposed.                     |
| List at scale              | —      | All rows render eagerly; no pagination/virtualization/search contract. |
| Failure + Retry            | ⚠️     | Domain request is covered; lessons request is not.                     |

## Strengths / good cases

- **✅ 亮点 — Rows are semantic navigation.** Runtime accessibility exposes P-01…P-13 as links.
- **✅ 亮点 — Hit ratio stays at the scan edge.** Stable columns align identity, title and usage.

## Experience gaps

1. 🔴 **Lesson failure renders an empty body under a non-zero total.** Lessons error/loading are discarded (`RulesDetail/index.tsx:32-33`, `:83-87`).
2. 🟠 **Not designed beyond fixture scale.** No search, layer/anchor filter, sort, paging or virtualization.
3. 🟡 **Page and card restate the same title.** Replace card shell with page toolbar + list.
4. 🟡 **Filter state is local, resets, and is not deep-linkable.** Move read state into URL/server query.

## Skill feedback

- Validates Read §§1.1, 1.2 and URL-backed multi-dimensional list state.

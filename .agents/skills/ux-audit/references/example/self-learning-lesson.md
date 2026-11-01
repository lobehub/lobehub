# UX Audit — Expertise rule detail

**Layers:** L1 ✅ · L2 desktop dark ✅ · L3 direct URL/list/breadcrumb ✅.

## Patterns in use

| Pattern                    | Rating | Evidence                                                      |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Sequence Map / Breadcrumbs | ✅     | Expertise → domain → all rules → P-code.                      |
| Titled Sections            | ✅     | Structured sections adapt to polarity.                        |
| Attached proof             | ⚠️     | Hit examples are shown but not linked to source Topic.        |
| Empty state                | ⚠️     | No-examples is explicit but has no explanation/action.        |
| Failure + Retry            | ✅     | Rule fetch distinguishes loading/error/not-found and retries. |

## Strengths / good cases

- **✅ 亮点 — Error and deletion differ.** Request error and resolved absence have separate states (`LessonDetail/index.tsx:84-93`).
- **✅ 亮点 — Structure follows polarity.** Stored section keys define the reading structure (`:112-123`).
- **✅ 亮点 — Deep-linkable reading chain.** List row, URL and breadcrumb preserve hierarchy.

## Experience gaps

1. 🟠 **Proof cannot be audited at source.** Backend returns `subjectId/subjectType`, but UI prints a title only (`:132-155`). Add source Topic link/date/unavailable state.
2. 🟠 **The entity remains unmanageable.** No correct/refine, retain-without-use, archive, merge or feedback action.
3. 🟡 **No-examples does not explain a possible count mismatch.** A generic Empty is insufficient provenance.
4. 🟡 **Secondary domain fetch has no failure representation.** The breadcrumb can remain an ellipsis while the rule body loads.

## Skill feedback

- Validates Act §3.9 correction/control and Read §1.1 compound fetches.

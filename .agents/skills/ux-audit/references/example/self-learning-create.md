# UX Audit — Create expertise modal

**Layers:** L1 ✅ · L2 desktop dark ✅ · L3 forward journey partial.

## Patterns in use

| Pattern         | Rating | Evidence                                                          |
| --------------- | ------ | ----------------------------------------------------------------- |
| Modal Panel     | ✅     | Imperative base-ui modal (`CreateDomainModal.tsx:97-105`).        |
| Forgiving Input | ✅     | One natural-language brief becomes an editable draft (`:26-89`).  |
| Preview         | ✅     | Parsed name/filter appear before Create (`:53-70`).               |
| Prominent Done  | ✅     | Continue/Create is the sole primary action (`:80-89`).            |
| Draft safety    | —      | State is in-memory and `maskClosable` is true (`:29-31`, `:101`). |

## Strengths / good cases

- **✅ 亮点 — Loose input before structure.** Forgiving Format composes well with Preview.
- **✅ 亮点 — Failure preserves fields.** `try/catch/finally` reports the error and leaves the draft intact (`:33-45`).

## Experience gaps

1. 🔴 **Mask close/reload loses the draft.** Remedy: durable draft plus dirty-close confirmation.
2. 🟠 **The ingestion boundary is previewed as text, not tested against examples.** Show matching/non-matching Topics before commitment.
3. 🟡 **Parsed step has no explicit Back.** Users can edit outputs but cannot revise the original sentence in the flow model.

## Skill feedback

- Validates Edit §2.1 and Act §3.1; no new generic rule landed.

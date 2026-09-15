# UX Audit — Self-evolving overview

Surface: `/agent/:aid/self-learning`. **Layers:** L1 ✅ · L2 desktop/760px dark ✅ · L3 keyboard/navigation ✅.

## Patterns in use

| Pattern                   | Rating | Evidence                                                                                           |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Empty-state as onboarding | ✅     | Empty/loading/error are distinct and Create is the primary CTA (`SelfLearning/index.tsx:154-187`). |
| Overview + Detail         | ⚠️     | Curve/list drill in, but the one-item redirect destroys the hub (`:95-100`).                       |
| Data Spotlight            | ✅     | Only three high-practice curves receive emphasis (`:107-125`).                                     |
| Titled Sections           | ✅     | Trend, insights and domains are grouped.                                                           |
| Clear Entry Point         | —      | Populated state has no Create action.                                                              |
| Responsive Disclosure     | ⚠️     | At 760px the wide sidebar remains and chart labels become tiny.                                    |

## Strengths / good cases

- **✅ 亮点 — Honest no-data projection.** The chart is omitted until a meaningful series exists (`:91-93`).
- **✅ 亮点 — Focused comparison.** Three emphasized curves avoid a rainbow plot (`:107-125`).
- **✅ 亮点 — Real first-run page.** Empty, failed and loading are separate; empty explains value and offers Create (`:154-187`).

## Experience gaps

1. 🔴 **Hub and Create disappear after the first item.** Unconditional one-item redirect plus Create only in Empty. The breadcrumb becomes a loop. Remedy: keep overview reachable and expose Create in its header.
2. 🟠 **Domain and insight rows are mouse-only pseudo-controls.** Runtime rows are `DIV`, no role, `tabIndex=-1`, absent from the interactive snapshot (`:243-264`, `:313-322`). Remedy: real Link/canonical row with focus-visible.
3. 🟠 **Model output, not attention, owns Center Stage.** The curve fills the first viewport while actionable insights start below the fold. Remedy: lead with needs-attention and next action; move evidence down.
4. 🟡 **Narrow desktop loses legibility.** At 760px the title wraps to four lines and chart labels shrink while the sidebar remains \~280px. Remedy: responsive shell and list-first alternative below useful plot width.
5. 🟡 **“学完了” hides fit uncertainty.** The overview converts a threshold-derived shape into certainty while detail carries unusable/speculative confidence.

## Skill feedback

- **Landed:** ux Read §1.6 now requires data shortcuts to preserve the stable hub and collection actions.
- Validated Act §3.4, keyboard semantics and Responsive Disclosure.

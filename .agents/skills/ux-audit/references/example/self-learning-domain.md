# UX Audit — Expertise domain detail

**Layers:** L1 ✅ · L2 desktop dark/zero-run/mature ✅ · L3 drill-down ✅.

## Patterns in use

| Pattern           | Rating | Evidence                                                          |
| ----------------- | ------ | ----------------------------------------------------------------- |
| Center Stage      | ⚠️     | Fit statement/chart dominate; action-relevant gaps are secondary. |
| Titled Sections   | ✅     | Trend, metrics, coverage, Top 5 and anchoring are separated.      |
| Overview + Detail | ✅     | Top 5 drills into all rules and individual rules.                 |
| Failure + Retry   | ⚠️     | Domain fetch is covered; independent lessons fetch is not.        |
| Forward Momentum  | —      | No-practice and anomaly states explain but offer no action.       |

## Strengths / good cases

- **✅ 亮点 — Unreliable fits do not invent a number.** The page explains why projection is withheld (`Detail/index.tsx:263+`).
- **✅ 亮点 — Zero practice is not failure.** A purpose-built state replaces a meaningless chart (`:135-149`).
- **✅ 亮点 — Canonical gaps stay visible.** Empty layers are not filtered out (`CoverageCloud.tsx`).

## Experience gaps

1. 🔴 **Lessons failure masquerades as zero lessons.** Only domain error/loading is read; lessons become `lessons ?? []` (`Detail/index.tsx:77-78`, `:224-230`).
2. 🟠 **No-practice is a dead end.** No start matching Topic, inspect likely matches, or edit boundary action.
3. 🟠 **Detected gaps have no corrective action.** Empty layers, unused and unanchored lessons are display-only.
4. 🟠 **Expertise lifecycle is read-only.** No edit, pause, archive or delete exists.
5. 🟡 **Implementation metrics precede the decision.** “What needs attention / what next” has no first-class block.

## Skill feedback

- Validates Read §1.1 multi-fetch failure and Act §3.4 lifecycle completeness.

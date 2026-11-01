# Release-Risk Verification Addendum

Apply only to findings with `dimension: "release-risk"`.

- **Data layer**: read the actual SQL and reader. Additive, reversible changes are false positives
  unless a concrete ordering or rollback hazard survives. For schemaless state, confirm a real
  legacy value reaches a reader that cannot handle it.
- **Dev-cycle churn**: confirm this PR both creates and later reworks the same object. An object that
  existed on trunk is a normal forward migration.
- **Prompt surface**: require a named behavioral delta. Confirm removed instructions were not moved
  elsewhere. Prompt findings are never auto-fixes.
- **High-frequency UI**: confirm the surface is on a first-minute path and an established behavior
  changed. Additive-only work and design preferences are false positives.
- **Shared surface**: reproduce the call-site count. No measurable blast radius or unchanged
  existing contract means false positive.
- **PR purity**: prove the proposed split builds and deploys independently. Shared dependencies or a
  broken intermediate state invalidate the finding.

Release-risk findings always use `can_auto_fix: false`.

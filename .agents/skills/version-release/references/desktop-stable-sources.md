# Desktop Stable Sources

Use this reference for Cloud selection, delivered hotfix baselines, rebuilds and historical imports. For patch branch and PR steps, see [Patch Release Scenarios](./patch-release-scenarios.md).

Stable desktop releases bind OSS and Cloud in the Release asset `desktop-sources.v1.json`. A matching `desktop-published.v1.json` proves the version completed the required delivery stages. A tag or a green job alone is not a delivered hotfix baseline.

| Path                                              | Cloud selection                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Weekly / explicit ordinary release, first attempt | Resolve Cloud HEAD once and save it before building.                                |
| Rebuild the same version                          | Read its existing source record; never choose HEAD again.                           |
| Hotfix, model-only patch, or targeted migration   | Explicitly inherit a delivered base version, with optional documented Cloud repair. |
| Historical version with no record                 | Import a verified full Cloud SHA and original run/attempt before rebuilding.        |

For a hotfix, use `bun run hotfix:branch --base v2.2.21` (the example version must already be delivered). Omit `--base` to select interactively from delivered versions. `--cloud-ref <full-SHA> --reason <repair>` records a Cloud fix on the new version. The script includes the selected base, full Cloud SHA and base-record hash in machine-readable PR metadata.

For an existing manual/Agent-created PR, generate that metadata using the installed GitHub CLI authentication, append the emitted HTML comment unchanged to the PR body, and keep its readable source summary alongside it:

```bash
GITHUB_REPOSITORY=lobehub/lobehub BASE_VERSION=2.2.21 \
  GH_TOKEN="$(gh auth token)" node .github/scripts/desktopReleaseCli.mjs hotfix-intent
```

The **Desktop Release Sources** PR check validates the base's delivery proof, hash and main ancestry. If main includes undelivered product changes, stop and choose the appropriate release path. After merge, auto-tag binds the same intent to the actual PR number, merge SHA and PR base SHA, and passes it to Stable. Automatic and manual hotfix entry points verify that merged PR and its base again. Do not infer the baseline from a patch number or let a missing record fall back to current Cloud HEAD.

Manual `release_mode=hotfix` resumes a Release with that bound intent; optional `base_version`, `cloud_ref` and repair reason inputs must match it. It cannot create a new hotfix intent or bypass PR validation. An older Release without metadata uses explicit historical import instead. For both ordinary and hotfix releases, only attempt 1 may create a missing source record; a later attempt must reuse an existing record or recover explicitly.

To rebuild an older version, run the repaired **Release Desktop Stable** workflow from a ref containing the current release tooling. Select `release_mode=rebuild`, target `version`, and `source_ref=v<version>`; the latter must resolve to that version's tag SHA. Keep both upload-skip inputs enabled for a dry-run. `release_mode=import` is a separate metadata-only operation: supply `cloud_ref`, `evidence_run_id` and `evidence_run_attempt`; it records sources without building or publishing installers. An import does not create delivery proof.

Current Core OTA and Canary/Beta source selection are outside this Stable change. Existing runs use their original workflow code; start a new manual run to use repaired tooling.

For a historical import, inspect that run attempt's logs or diagnostic `cloudRef` and verify it equals the supplied Cloud SHA. The resolver validates the run/attempt and OSS SHA; the operator supplies the verified Cloud evidence. If delivery proof is missing, do not hand-author it: complete the required build/publication checks through the pinned-source pipeline before selecting that version as a delivered hotfix base.

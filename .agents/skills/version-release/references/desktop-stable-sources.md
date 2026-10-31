# Desktop Stable Sources

Use this reference for Cloud selection, delivered hotfix baselines, rebuilds and historical imports. For patch branch and PR steps, see [Patch Release Scenarios](./patch-release-scenarios.md).

Stable desktop releases bind OSS and Cloud in the Release asset `desktop-sources.v1.json`. A matching `desktop-published.v1.json` proves the version completed the required delivery stages. A tag or a green job alone is not a delivered hotfix baseline.

| Path                                              | Cloud selection                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Weekly / explicit ordinary release, first attempt | Resolve Cloud HEAD once and save it before building.                                |
| Rebuild the same version                          | Read its existing source record; never choose HEAD again.                           |
| Hotfix, model-only patch, or targeted migration   | Explicitly inherit a delivered base version, with optional documented Cloud repair. |
| Historical version with no record                 | Import a verified full Cloud SHA and original run/attempt before rebuilding.        |
| New hotfix recovering an undelivered main version | Explicitly pin the actual main base SHA, full Cloud SHA and recovery reason.        |

For a hotfix, use `bun run hotfix:branch --base v2.2.21` (the example version must already be delivered). Omit `--base` to select interactively from delivered versions. `--cloud-ref <full-SHA> --reason <repair>` records a Cloud fix on the new version. The script includes the selected base, full Cloud SHA and base-record hash in machine-readable PR metadata.

For an existing manual/Agent-created PR, generate that metadata using the installed GitHub CLI authentication, append the emitted HTML comment unchanged to the PR body, and keep its readable source summary alongside it:

```bash
GITHUB_REPOSITORY=lobehub/lobehub BASE_VERSION=2.2.21 \
  GH_TOKEN="$(gh auth token)" node .github/scripts/desktopReleaseCli.mjs hotfix-intent
```

The **Desktop Release Sources** PR check validates the base's delivery proof, hash and main ancestry. If main includes undelivered product changes, stop and choose the appropriate release path. After merge, auto-tag binds the same intent to the actual PR number, merge SHA and PR base SHA, and passes it to Stable. Automatic and manual hotfix entry points verify that merged PR and its base again. Do not infer the baseline from a patch number or let a missing record fall back to current Cloud HEAD.

Manual `release_mode=hotfix` resumes a Release with that bound intent; optional `base_version`, `cloud_ref` and repair reason inputs must match it. It cannot create a new hotfix intent or bypass PR validation. An older Release without metadata uses explicit historical import instead. For both ordinary and hotfix releases, only attempt 1 may create a missing source record; a later attempt must reuse an existing record or recover explicitly.

## Recover an undelivered version as a new hotfix

When main has a version whose desktop installers were never delivered, ordinary `--base` inheritance is unavailable. A new hotfix may instead carry an explicit `recovery` intent. This selects sources for the new release and does not claim the old version was delivered.

```bash
GITHUB_REPOSITORY=lobehub/lobehub \
  RECOVERY_BASE_SHA=FULL_MAIN_BASE_SHA CLOUD_REF=FULL_CLOUD_SHA \
  CLOUD_OVERRIDE_REASON='Reason for explicitly selecting these sources' \
  node .github/scripts/desktopReleaseCli.mjs recovery-intent
```

Replace both SHA placeholders with verified full commits. Read the base from the actual PR (`gh api repos/lobehub/lobehub/pulls/PR_NUMBER --jq .base.sha`), and append the generated comment to that PR. The PR check requires the base still matches; if main moves, reselect and verify the source combination. Auto-tag binds the intent to the actual PR number, base and merge SHA. Stable verifies that identity again, records `selection=recovery` with its frozen base/reason, and checks out the explicit Cloud SHA. It never selects HEAD or invents delivery proof for the old version.

Manual `release_mode=recovery` only resumes a Release with that bound recovery intent; supplied Cloud SHA and reason must agree. The first-attempt/create-only rules still apply. Later rebuilds read the saved record. The new version becomes a delivered baseline only after its own complete publication succeeds.

If the initial source-record write failed before any build/publication, a later attempt with no record must stop. Verify the Release's bound recovery intent, actual merged PR/tag and pinned Cloud SHA, then start a **new manual Release Desktop Stable run** from the current tooling ref with `release_mode=recovery`, the new `version`, and `source_ref=v<version>`. Leave optional Cloud/reason inputs empty to use the bound intent; keep both upload-skip inputs enabled for a verification build. Attempt 1 of this explicit run may create the missing record from those same pinned sources; it cannot overwrite an existing record. If a previously saved record was lost, recover its original content instead; do not replace its identity or invent historical import evidence.

## Rebuild and historical import

To rebuild an older version, run the repaired **Release Desktop Stable** workflow from a ref containing the current release tooling. Select `release_mode=rebuild`, target `version`, and `source_ref=v<version>`; the latter must resolve to that version's tag SHA. Keep both upload-skip inputs enabled for a dry-run. `release_mode=import` is a separate metadata-only operation: supply `cloud_ref`, `evidence_run_id` and `evidence_run_attempt`; it records sources without building or publishing installers. An import does not create delivery proof.

Current Core OTA and Canary/Beta source selection are outside this Stable change. Existing runs use their original workflow code; start a new manual run to use repaired tooling.

For a historical import, inspect that run attempt's logs or diagnostic `cloudRef` and verify it equals the supplied Cloud SHA. The resolver validates the run/attempt and OSS SHA; the operator supplies the verified Cloud evidence. If delivery proof is missing, do not hand-author it: complete the required build/publication checks through the pinned-source pipeline before selecting that version as a delivered hotfix base.

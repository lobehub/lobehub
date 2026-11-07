# Release record and evidence contract

## Directory layout

Keep a durable directory outside the checkout, one per prepared candidate:

```text
release.json                 # machine-readable preparation and gate verdicts
release-input.patch          # exact staged + unstaged release-input diff against source.sha
report.md                    # human-readable notes, coverage, compatibility, risks
scope.json                   # conservative workspace map + changed/dirty paths
logs/*.log                   # complete command outputs
logs/*.json                  # command/cwd/time/exit-code/log receipts
pack.json                    # actual npm pack output
pack-stderr.log
pack-run.json
<filename-from-pack.json>    # the exact tarball
handoff.json                 # readiness seal, only created after successful validation
tools/                       # copied standalone human publication entry and its modules
publish-attempt.json         # written by the human entry; not proof of availability
verification/*.json          # append-only, timestamped read-only verification rounds
```

`init` creates the skeleton of `release.json`. All paths inside it are **relative to this directory**, allowing intact transfer without changing the seal. Local evidence must be copied into the release directory; do not depend on ephemeral harness overflow files. Avoid credential-bearing URLs or raw auth/debug logs. Keep secrets out of commands/argv too: command receipts record arguments.

## Required fields

| Field                     | Meaning                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`           | `2` for new preparations; existing schema-1 records/seals retain their original rules                                                     |
| `package`, `registry`     | Exactly `@lobehub/cli`, `https://registry.npmjs.org`                                                                                      |
| `version`, `tag`          | Confirmed SemVer and `latest`, `next` or `beta`; no prerelease on `latest`                                                                |
| `baseline.version`        | Published version used for the primary release summary                                                                                    |
| `baseline.channelVersion` | Selected tag's exact version at preparation; `null` only if that tag does not exist                                                       |
| `baseline.stableVersion`  | Published `latest` version, also used for comparison when creating a new channel                                                          |
| `baseline.sourceSha`      | Full verified source commit for the published baseline; empty when historical provenance is unavailable                                   |
| `baseline.provenance`     | `npm-gitHead`, `release-record`, or `verified-release-ref`; empty when unknown, never `version-bump`                                      |
| `comparison`              | Schema 2: full `sourceSha`, `kind` (`verified-release` or `repository-reference`), and nonempty `reason` explaining the basis/limitations |
| `source.sha`              | Actual full source commit used to build; do not replace it later with a bump PR SHA                                                       |
| `source.patch`            | Exact release-input patch against that SHA; file exists even when empty                                                                   |
| `artifact`                | `path`, `sha256`, full `integrity`, `size`, tested `node`, `platform`; populated by `stamp`, reviewed after smoke                         |
| `gates`                   | Every named gate below, even when blocked or exempt                                                                                       |
| `repositorySync`          | `state`: `NOT_REQUESTED`, `PR_OPEN`, or `MERGED`; actual `pr` URL or `null`                                                               |

`comparison` and `baseline` answer different questions. A `verified-release` comparison must match the evidenced baseline SHA and pass the baseline gate. A `repository-reference` comparison may use an identified version-sync commit while leaving historical provenance UNKNOWN. In that case only the baseline gate is informational; scope, product acceptance, compatibility and all current-candidate gates remain mandatory. A baseline FAIL is never waived. The scope evidence must establish ancestry, reviewed repository changes, and any limitations of the chosen reference.

Example for an unavailable historical source binding (replace the example SHA):

```json
{
  "comparison": {
    "sourceSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "kind": "repository-reference",
    "reason": "Previous CLI version-sync commit; this summary describes repository changes, not exact differences from the old npm tarball."
  }
}
```

Do not alter an existing schema-1 record or seal to opt into schema 2. Create a new preparation instead. `verify` can inspect either schema without requiring publication eligibility.

Version ordering uses SemVer precedence, including numeric prerelease identifiers; build metadata does not make an already used version newer. Exact-version availability is always checked against npm, not inferred from `dist-tags` alone. If a channel advances in either direction, the human entry stops rather than moving it back.

## Gate states

A new record starts with `UNKNOWN` for all eleven gates. Populate states only from observations, never to satisfy the validator.

A passing gate has this shape (example filenames must be replaced by captured files):

```json
{
  "checkedAt": "2026-11-03T09:00:00.000Z",
  "evidence": [
    {
      "ref": "logs/build-1793696400000.log",
      "note": "Inspected the full build log: workbench report, CLI/worker bundles and man pages completed without unresolved imports."
    }
  ],
  "runs": ["logs/build-1793696400000.json"],
  "status": "PASS"
}
```

- `evidence` must be nonempty. Each entry has `ref` (relative local file or HTTPS URL) and `note` explaining **what was inspected and proven**.
- `checkedAt` records the inspection time, not an invented execution time.
- `runs` is mandatory for `lintTests`, `types`, `bundleTests`, `build`, `smoke`. Every referenced receipt must have `exitCode: 0`, a command and an existing output log. Include all required successful commands for that gate, not just a convenient successful subset.
- Keep failed runs in the directory and explain them in the report. The passing gate references the successful replacement runs; failures do not disappear from history.
- A URL-shaped string is not proof of valid acceptance or deployment. The helper validates structure and local file availability, **not remote evidence truth, recency or coverage**. The agent must inspect those properties.

An exemption has a specific reason:

```json
{
  "reason": "Only CLI version metadata changed; there is no changed product behavior requiring new acceptance.",
  "status": "EXEMPT"
}
```

Only `acceptance` and `backend` can be exempt. Reusing valid acceptance is `PASS` with evidence, not `EXEMPT`. Missing credentials, missing reports, an unavailable backend or a deadline are `UNKNOWN`/`FAIL`, never exemption reasons.

For `FAIL` or `UNKNOWN`, retain observations in `evidence` when available and a `reason` describing the gap and next action. Only historical baseline UNKNOWN in an explicit schema-2 repository comparison does not block handoff. It is not PASS or EXEMPT. Omitting a gate or spelling a different status cannot make the record ready.

## What each gate must establish

| Gate          | Required proof                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline`    | Published package ↔ verified source reference; or explicitly UNKNOWN with a schema-2 repository comparison, without claiming npm provenance                    |
| `version`     | User's target/tag decision, local/stable/channel versions, SemVer ordering, explicit exact-target absence and only intended metadata edits                     |
| `scope`       | Reviewed dependency/build closure, comparison ancestry/diff, deleted files, captured release inputs and limitations; summary agrees with the chosen comparison |
| `lintTests`   | Concrete release-scoped source/test paths, successful lint/test receipts and reviewed autofixes                                                                |
| `types`       | Successful repository type gate, with any prior failure/approved repair disclosed                                                                              |
| `bundleTests` | Explicit bundle/config regression receipts for the current release                                                                                             |
| `acceptance`  | Outcome-by-outcome coverage table, inspected reusable evidence plus any newly verified gaps on the proper surfaces; or valid behavior-neutral exemption        |
| `backend`     | Target environment and actual deployment/contract support for each dependent outcome; or reason no new backend requirement applies                             |
| `build`       | Complete `prepublishOnly` lifecycle, expected version/help, required generated outputs and no unresolved imports                                               |
| `tarball`     | Actual archive/packed manifest inspection, correct metadata/bin/files/runtime dependencies, private-file/content review, recorded fingerprints                 |
| `smoke`       | Successful real npm tarball install outside the repo, all bin aliases, appropriate affected command/offline/native checks, actual runtime/platform limits      |

For multi-outcome gates, cite the coverage table **and** underlying evidence. One passing outcome does not stand for all changed behavior. A read-only command's exit status alone does not prove the returned version or data was correct; inspect its output.

## Detailed report

`report.md` holds what should not crowd the chat:

1. Package, target/channel/registry, comparison reference and limitations, historical provenance, source SHA plus patch, preflight/approved repairs, toolchain/platform.
2. Added/Fixed/Changed/Breaking changes and upgrade notes, with commit/PR references. No empty sections or unverified release claims.
3. Outcome/acceptance/backend coverage table; reuse rationale, deployment evidence, self-hosted requirements and known limitations.
4. Each gate's verdict, evidence and command receipts; failed attempts and approved repairs honestly recorded.
5. Exact artifact filename, hashes, size, inspected contents and smoke environment; transfer the whole directory unchanged.
6. Separate artifact, preparation, npm and repository-sync statuses (`release.mjs status`). Missing current release conditions are blockers, not footnotes under `READY`. Historical provenance limitations stay visible even when they do not block handoff.

The handoff helper seals this report, the preparation record, patch, local evidence/command receipts/logs, artifact and copied publication tools. Once handed off, do not edit them. Changed candidate/evidence requires new preparation and revalidation of affected gates. The seal detects accidental drift; it is not a signed supply-chain attestation.

Post-publication facts belong in **new** `verification/*.json` files, not by rewriting the prepublication report. Only `repositorySync` may be updated independently in `release.json`; it is deliberately outside the preparation seal. Mark `MERGED` only after actually observing the merge. A PR link proves creation, not integration.

## Interpreting publication records

- `publish-attempt.json`: the human entry records intent before calling npm. Exit zero becomes `SUBMITTED`, not `VERIFIED`. Interruption/nonzero remains uncertain until investigated. Its existence prevents blind repeat calls.
- `verification/*.json`: each round retains all observed responses, expected integrity and final result. `preparationSeal: MATCHED / ABSENT` distinguishes a sealed preparation from independent human publication. Missing approval is not a reason to refuse read-only verification. Existing seals must match; verification never changes gates or creates a handoff. `PENDING` observations may precede `VERIFIED`; they are not failed publications.
- `UNCONFIRMED`: polling budget exhausted, nothing established about eventual success/failure. Resume only read-only verification later.
- `UNKNOWN`: query/auth/network/schema problem; resolve that before drawing conclusions about availability.
- `MISMATCH` / `CHANNEL_CHANGED`: investigate the discrepancy; never fix by automatic republishing, retagging or unpublishing.
- `VERIFIED`: exact version and full registry integrity equal the prepared artifact, selected tag points to target. This proves registry availability/identity, not a new feature acceptance run.

A later release may reuse this directory as baseline provenance only after checking its verified result, source SHA/patch and full integrity against registry metadata. A VERIFIED registry observation alone cannot establish a source binding. If historical records are unavailable, use the explicitly labeled repository-comparison path rather than pretending a Git reference proves old npm contents.

For cross-machine discovery, put a sanitized release index in the version-sync PR: package/version/tag, prepared SHA, patch SHA-256, full integrity, observed verification result and an approved team-accessible record location. Never include local user paths, credentials, raw logs or conversation details. The index locates the complete record; it does not replace the patch, logs or inspected evidence. Keep transferring the whole directory unchanged.

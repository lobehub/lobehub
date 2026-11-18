---
name: cli-npm-release
description: 'Manual-only npm release preparation for @lobehub/cli (lh): summarize repository changes, preflight the environment, verify one tarball, hand publication to a human, then verify registry identity. Never publishes automatically.'
disable-model-invocation: true
user-invocable: true
argument-hint: '[target-version] [--tag latest|next|beta]'
---

# CLI npm Release

The agent prepares and verifies; an authorized human publishes. Optimize for **one clear next action**. Preserve the guarantee that **the published bytes are the tested bytes**, without making missing historical records block independent preparation work.

## Invocation and boundaries

- Run only on explicit skill invocation: `/skill:cli-npm-release`, `/cli-npm-release`, `$cli-npm-release`, or the harness's equivalent. A generic release request, another skill, subagent, hook, or CI is not authorization. Arguments are data, not shell code.
- Keep `disable-model-invocation: true` and `agents/openai.yaml`'s implicit invocation prohibition. If a harness cannot enforce manual discovery, keep this skill out of its automatic discovery.
- **Never execute `scripts/humanPublish.mjs`, its prepared copy, `npm publish` (including dry runs), equivalent registry mutations, or a publishing workflow.** Do not test the human entry or drive its terminal confirmation.
- Do not log in to npm, request tokens/OTPs, inspect credential files, or print secrets. Authentication and 2FA stay in the human's terminal. Public registry reads need no publisher credentials.
- No automatic commits, pushes, Git tags, branch switching, root app version changes, or releases of other packages. Repository synchronization requires explicit authorization.
- Preserve unrelated edits. Never reset, clean, stash, or delete generated caches to manufacture a passing tree. Ask once for approval of any necessary environment repair or isolated preparation environment, with its scope; no silent dependency upgrades.
- No directory-based publishing, rebuilding at publication time, bypass flags, or bare `npm publish` fallback when the guarded handoff is blocked.

## State and communication

Track four independent facts; `status` reports them without changing the record:

| Axis                       | States                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Artifact                   | `ABSENT / BUILT / VALIDATED / INVALID`                                                   |
| Preparation                | `BLOCKED / READY_FOR_HANDOFF`, plus handoff seal state                                   |
| npm publication            | `NOT_OBSERVED / PENDING / VERIFIED / UNCONFIRMED / UNKNOWN / MISMATCH / CHANNEL_CHANGED` |
| Repository synchronization | `NOT_REQUESTED / PR_OPEN / MERGED`                                                       |

A validated package can still have release blockers. A manually published package can be verified without retroactively approving its preparation. HTTP 202 or a zero publish exit code is not proof of registry availability.

Use the user's language. Explain milestones and actionable blockers, not every file read. Put detailed notes, checksums and logs in `report.md`. Never say merely “all checks passed” while release conditions remain unresolved. Continue independent work; stop only the action that needs the missing condition.

## 1. Establish inputs and preflight before building

Read [references/preparation.md](references/preparation.md) for commands and [references/record.md](references/record.md) for the evidence contract.

The standing default is **increment `0.0.x` by one and use `latest`**. When local and npm stable versions agree at `0.0.x`, announce the computed target and proceed under this default; do not ask again. Ask once if the versions diverge, the default does not apply, the target is occupied, or a prerelease/non-default channel is requested. Explicit invocation arguments override the default. Never silently bump a local version already ahead of npm.

Require valid SemVer newer than the selected channel (stable if a new channel), and explicit version-not-found for the exact target. Network/auth/registry errors do not prove availability. Prereleases require an explicitly confirmed non-`latest` tag.

Initialize a unique **durable directory outside the repository**, not `/tmp`, with `release.mjs init`. Retain the record, report, patch, logs, evidence and tarball together. Run **`release.mjs doctor <repo-root>` before the first build**. It checks CLI declarations, root report dependencies, required local tools, Node and actual lockfile policy without installing anything. Resolve its findings before producing a candidate; capture a new resolution snapshot after an approved install. A successful doctor is not a substitute for quality gates or complete build-scope inspection.

## 2. Separate comparison scope from historical provenance

Prefer the published package's verified `gitHead`, a previous verified release record (source SHA **and patch** bound to full registry integrity), or an evidenced release reference. Check ancestry and account for any old source patch.

If these are unavailable, use an identifiable repository reference such as the previous CLI version-sync commit. Record it as `comparison.kind: repository-reference` with its full SHA, selection reason and limitation. Keep `baseline` provenance `UNKNOWN`; **do not claim that a version-bump commit proves what npm shipped**. This is the supported bootstrap path, not a force flag. A known conflicting provenance result (`FAIL`) still requires investigation.

Missing old provenance limits the claim to **repository changes since the stated reference**; it does not block the current candidate's tests, build, packing or handoff when its actual release gates pass. If no defensible comparison can be found, request a reference and leave scope unresolved; independent build/smoke work may continue.

Run `release.mjs scope <repo-root> <comparison-sha>` once. Review its conservative workspace closure, imports/build inputs, offline report dependencies and deleted files. Record justified narrowing instead of rescanning repeatedly.

Write concise Added / Fixed / Changed / upgrade notes with commit/PR references. Describe user outcomes and distinguish newly added behavior from an existing mechanism gaining another provider. Explicitly label the comparison basis and backend requirements.

## 3. Resolve release conditions early, not at handoff

The record retains all eleven gate entries: `baseline`, `version`, `scope`, `lintTests`, `types`, `bundleTests`, `acceptance`, `backend`, `build`, `tarball`, `smoke`.

- `PASS`: inspected evidence, location, what it proves and inspection time. Command gates need successful receipts.
- `FAIL`: observed failure with remediation; never downgrade a known failure to missing history.
- `UNKNOWN`: missing/uninspected evidence. Blocks handoff except the explicitly labeled historical baseline in a schema-2 repository comparison.
- `EXEMPT`: only for genuinely inapplicable `acceptance` or `backend`, with a specific reason. Not a waiver for missing access, time or evidence.

Immediately after identifying changed outcomes, build the acceptance/backend coverage table. Apply `../acceptance/SKILL.md`: **open and inspect existing reports and artifacts**, check later changes, reuse valid coverage, then verify only gaps. Do not stop at PR-body links and later report “evidence missing.” Request authorization only for missing credentials, paid or state-changing actions; use approved isolated test contexts.

For a required new backend contract, record the actual target deployment or a real compatible round-trip. Merged PRs do not establish deployment. Unit tests and `--help` do not establish product acceptance. Unresolved applicable acceptance/backend gates still block handoff; never bypass them with a raw publication command.

Load the testing skill and run the scoped lint/tests, repository type gate and explicit CLI bundle/config tests in the preparation reference. Use `release.mjs run` to retain logs and exit codes. Review autofixes. Run heavy tests and the full type gate sequentially on a constrained machine. Repair stale generated types through an approved reproducible environment, not ad-hoc Next internal APIs or cache deletion. Never run repository-wide `bun run test`.

## 4. Build and verify one exact candidate

After environment repair and release-input changes are settled, run the full `prepublishOnly`, check outputs, pack, stamp, inspect the archive and install the exact tarball outside the repository as in the preparation reference.

- `npm pack` does not run `prepublishOnly`.
- Derive files from current build configuration and `pack.json`; do not hardcode worker extensions.
- Check all bin aliases, man pages, offline report and relevant native behavior. Reject unresolved workspace runtime dependencies, secrets and unintended/private files.
- Use isolated HOME/environment and a realpath TMPDIR. Do not mutate global CLI installations, connect personal daemons or borrow personal credentials.
- Changed inputs invalidate affected evidence. Rebuild/retest after dependency or source changes. Never overwrite a packed candidate: use a new directory and preserve the old record.

## 5. Hand off exactly one guarded human command

Complete the report, inspect `release.mjs status <release-directory>`, and resolve its blockers. Then run the **non-publishing** helper:

```bash
node "$SKILL_DIR/scripts/release.mjs" handoff "$RELEASE_DIR"
```

It checks gates/evidence/receipts, artifact identity, target availability and channel stability; seals the candidate and copies the human-only entry. It cannot judge evidence truth for you. Never set `PASS` just to satisfy it.

Reply briefly:

> **<version> 已准备好，尚未发布。**
> 下一步：在自己的终端执行下面这一条命令。
> `<exact command printed by handoff>`
> 完成后告诉我；我会核对 npm 版本、完整性和频道。
> 详细记录：`<absolute report.md path>`

For a blocked handoff, name the remaining conditions and what you can check next; do not produce a runnable alternative. The human entry rechecks the seal/artifact/gates, npm identity, target and channel, asks for version confirmation, then publishes the tarball with `--ignore-scripts`. This avoids rebuilding tested bytes, not the required preparation lifecycle. `whoami` proves identity, not permission; npm can still reject publication. TTY is an accidental-use guard, not an authorization sandbox.

## 6. Verify after any reported human publication attempt

```bash
node "$SKILL_DIR/scripts/release.mjs" verify "$RELEASE_DIR"
```

This only reads npm and writes append-only local verification records. It works even if the human published independently and no handoff exists: validate package/version/tag and local artifact fingerprints, record `preparationSeal: ABSENT`, and leave all preparation gates unchanged. An existing seal must match; never ignore a corrupt or changed seal. This proves registry identity, **not publication approval or feature acceptance**. Do not write a replacement polling script.

Up to eight checks use increasing delays, a ten-minute budget and bounded registry calls:

- HTTP 202 / “being processed,” temporary target 404 or old tag: wait, do not repeat publishing.
- Exact version, full integrity and selected tag match: `VERIFIED`.
- Budget exhausted: `UNCONFIRMED`; preserve the artifact and resume read-only verification later.
- Query errors: `UNKNOWN`, not absence. Integrity mismatch or unexpected channel movement requires investigation, not automatic tag changes or republishing.

For diagnostics, first ask for the redacted publish result. Never scan arbitrary auth/npm logs or compare truncated integrity previews.

## 7. Synchronize the repository and make the next release discoverable

Report npm publication and repository synchronization separately. On explicit authorization, use the `pr` skill for the version/manual synchronization PR. Do not include incidental lint changes without authorization.

Record the actual PR URL and `NOT_REQUESTED / PR_OPEN / MERGED`. Never rewrite the original prepared SHA/patch to a later merge SHA. Existing sealed schema-1 records remain valid; do not migrate or edit them in place.

Include a **sanitized release index** in the synchronization PR: package/version/tag, prepared source SHA, source-patch SHA-256, full tarball integrity, verified registry result and a team-accessible record location when available. Exclude local usernames/paths, credentials, raw logs and conversation details. A PR summary alone is a discovery aid, not a replacement for the source patch/evidence. With authorization, transfer the complete record to durable team storage so another machine can retrieve it. Check its actual source binding and registry integrity before reusing it as the next baseline.

---
name: cli-npm-release
description: 'Manual-only npm release preparation for @lobehub/cli (lh): establish evidence-backed release gates, prepare one verified tarball, hand a single publication entry point to a human, then verify registry availability. Never publishes automatically.'
disable-model-invocation: true
user-invocable: true
argument-hint: '[target-version] [--tag latest|next|beta]'
---

# CLI npm Release

The agent prepares and verifies; an authorized human publishes. Optimize for **one clear next action**, not a long checklist pasted into chat. Preserve the guarantee that **the published bytes are the tested bytes**.

## Invocation and boundaries

- Run only on explicit skill invocation: `/skill:cli-npm-release`, `/cli-npm-release`, `$cli-npm-release`, or the harness's equivalent. A generic release request, version bump, another skill, subagent, hook, or CI is not authorization to invoke this workflow. Arguments are data, not shell code.
- Keep `disable-model-invocation: true` and `agents/openai.yaml`'s implicit invocation prohibition. If a harness cannot enforce manual discovery, keep this skill out of its automatic discovery.
- **Never execute `scripts/humanPublish.mjs`, its prepared copy, `npm publish` (including dry runs), any equivalent package-manager/registry mutation, or a publishing workflow.** You may prepare the human entry point and print its invocation. Never test it by executing it or drive its terminal confirmation for the user.
- Do not log in to npm, request tokens/OTPs, inspect credential files, or print secrets. Human authentication and 2FA stay in the human's terminal. Public registry reads need no publisher credentials.
- No automatic commits, pushes, Git tags, branch switching, root app version changes, or releases of other packages. Repository synchronization is a separate, explicitly authorized task.
- Preserve unrelated edits. Never reset, clean, stash, or delete generated caches to manufacture a passing tree. Dirty release inputs or environment repairs require the user's resolution or approval of an isolated preparation environment.
- A simpler UX must **not** offer directory-based publishing, rebuilding at publication time, or bypass flags as an alternative to the verified artifact.

## State and communication

```text
PREPARING → BLOCKED or READY_FOR_HUMAN_PUBLICATION
                        ↓ human acts
                    SUBMITTED / PROCESSING → VERIFIED
                                           → UNCONFIRMED / UNKNOWN / MISMATCH / CHANNEL_CHANGED
```

`READY` is not published. A zero publish exit code or HTTP 202 is not proof of registry availability. `VERIFIED` requires the exact version, full integrity and selected tag to match.

Use the user's language. Explain only milestones and blockers; do not narrate every file read. Put release notes, checksums and logs in the persistent report. Ask once for unresolved release decisions; do not repeatedly ask users to approve routine local checks.

## 1. Establish inputs and create the release record

Read [references/preparation.md](references/preparation.md) for exact commands and [references/record.md](references/record.md) for the evidence contract.

Inspect current manifests, build scripts, locks, Git state and tool versions. Read npm stable and selected-channel metadata from `https://registry.npmjs.org`.

- Confirm target and tag before edits. If omitted, recommend a version and explain briefly; never silently bump a local version already ahead of npm.
- Require valid SemVer newer than the selected channel (stable if a new channel), and explicit version-not-found for the exact target. Network/auth/registry errors are not availability. Prereleases must use an explicitly confirmed non-`latest` tag.
- Initialize a **durable directory outside the repository**, not a disposable `/tmp` directory. Use `scripts/release.mjs init <absolute-directory>`; it creates `release.json` with every gate `UNKNOWN`.
- Keep `release.json`, `report.md`, the source patch, logs, evidence and tarball together. Never commit credentials or incidental artifacts. Preserve them for the next release and transfer the entire directory unchanged if the publisher uses another machine.

## 2. Resolve the baseline and affected scope

Resolve baseline provenance in this order:

1. Published package's `gitHead`, verified against the local commit.
2. A previous release record binding source SHA **and patch** to the registry's full `dist.integrity`, with successful post-publish verification.
3. A verified release-specific tag/reference whose relationship to the published package is evidenced.

Check ancestry against the candidate. **A commit that bumped `package.json`, or a commit merely being an ancestor, does not establish release provenance.** If unresolved, ask for the missing release reference and mark `baseline: UNKNOWN`; do not invent complete release notes or allow `READY`.

Run `scripts/release.mjs scope <repo-root> <full-baseline-sha>` once and save its JSON. It maps actual package names and follows workspace dependency edges across both revisions. It is a conservative starting scope, not a precise bundle reachability claim. Review imports/build inputs, root locks, offline report dependencies and deleted files; record justified narrowing rather than repeatedly scanning the same packages.

Inspect the release diff, not only local edits. Write concise **Added / Fixed / Changed / Breaking changes and upgrade notes** with commit/PR references. Separate version metadata from behavior. Identify backend-dependent outcomes; merged PRs do not establish deployment.

## 3. Complete evidence-backed gates

All gates are mandatory entries in `release.json`:

`baseline`, `version`, `scope`, `lintTests`, `types`, `bundleTests`, `acceptance`, `backend`, `build`, `tarball`, `smoke`.

- `PASS`: inspected evidence, its location, what it proves and inspection time. Command gates additionally need successful command receipts.
- `FAIL`: observed failure, with remediation.
- `UNKNOWN`: missing/uninspected evidence or a check not run. **Blocks readiness.**
- `EXEMPT`: allowed only for `acceptance` or `backend`, with a specific applicability reason. Not a waiver for missing access, time or evidence.

Use `release.mjs run` to retain full logs and actual exit codes without shell pipelines. It records execution, **not gate approval**. Load the testing skill when selecting or diagnosing release tests. Run the release-scoped lint/tests, repository type gate and explicit CLI bundle/config tests in the preparation reference. Never run repository-wide `bun run test`.

Apply `../acceptance/SKILL.md`: inspect existing reports and evidence first; map coverage to each changed outcome and check subsequent changes. Reuse valid evidence without rerunning just for a release. Verify only missing/invalidated outcomes against the candidate and the appropriate real backend/surface. `--help` is packaging smoke, not feature acceptance. Lack of approved test credentials is a blocker, not an exemption.

For new backend contracts, record target environment, actual deployed contract/version evidence or a real compatible backend round-trip. **Neither “merged into canary” nor “should have acceptance” is evidence.** Unverified required contracts block readiness.

## 4. Build, pack and verify the exact artifact

Follow [references/preparation.md](references/preparation.md): run `prepublishOnly`, verify generated outputs, pack, stamp checksums, inspect the archive, then install the tarball with npm in a disposable directory outside the repo.

- `npm pack` does not run `prepublishOnly`.
- Artifact paths come from the current build configuration and `pack.json`, not hardcoded worker extensions.
- Verify all bin aliases, man pages, offline report and relevant native behavior; reject unresolved workspace runtime dependencies or unintended/private files.
- Do not mutate global CLI installations, connect personal daemons or borrow personal credentials for smoke tests.
- Review lint autofixes and retain all release-input diffs. Changed inputs invalidate affected checks; rebuild and retest before packing again. Never overwrite a handed-off tarball. Use a new preparation directory for a changed candidate.

## 5. Hand off one human-only command

Complete `report.md`, then run the **non-publishing** helper:

```bash
node "$SKILL_DIR/scripts/release.mjs" handoff "$RELEASE_DIR"
```

It fails closed on missing gates/evidence/receipts, changed tarball, occupied version or changed channel; seals the record and local evidence; copies the standalone human entry point into the release directory; and prints **one concrete command**. It cannot judge the truth or coverage of evidence for you: do not mark a gate `PASS` merely to make it succeed.

Reply in this shape, replacing all examples with real results:

> **0.0.74 已准备好，尚未发布。**
> 下一步：你在自己的终端执行下面这一条命令。
> `[the exact single command printed by handoff]`
> 完成后告诉我；我会核对 npm 版本、完整性和频道。
> 详细记录：`<absolute report.md path>`

Do not paste the full audit report or inline hash program into chat. For `BLOCKED`, give the missing proof and next action instead; **do not generate a runnable publication command**.

The human entry point checks the seal, artifact, gates, npm identity, exact target availability and unchanged channel; asks the human to confirm the version; rechecks immediately before publishing the tarball with `--ignore-scripts`. This flag avoids lifecycle execution on the already built/tested tarball; it never replaces `prepublishOnly`. `whoami` proves identity, not publishing permission. Login/2FA remains human-owned. TTY/confirmation is an accidental-use guard, not an authorization sandbox; the agent prohibition still applies.

## 6. Verify after the human reports publication

The preparation stops at the human handoff, **not** at read-only post-publication verification. After the user reports a publish attempt, run:

```bash
node "$SKILL_DIR/scripts/release.mjs" verify "$RELEASE_DIR"
```

This only reads npm and writes local verification records. It performs up to eight checks with increasing delays, a ten-minute polling budget and bounded individual registry calls (an in-flight query may finish after the budget).

- HTTP 202 / “being processed”: accepted for processing; do not call it failed or already available.
- Temporary version 404 or old tag: `PENDING`; wait, do not repeat publishing. Thirty seconds of invisibility is not proof of failure.
- Version, **full** integrity and selected tag match: `VERIFIED`.
- Budget exhausted: `UNCONFIRMED`; retain artifact and attempt history. A later invocation can resume read-only verification without rebuilding.
- Registry errors: `UNKNOWN`; distinguish these from absence. Integrity mismatch or unexpected channel movement requires investigation, not automatic tag changes or republishing.

If diagnostics are needed, first ask for the publish command's redacted result/status. Do not scan arbitrary npm/auth logs. Never compare a truncated integrity preview as if it proved byte equality.

## 7. Repository synchronization and next release

Report two independent statuses: **npm publication** and **repository synchronization**. Offer the version-bump PR only after explicit user authorization, through the `pr` skill; do not silently include incidental lint changes. Confirm their scope if inclusion is needed.

Record PR URL and `NOT_REQUESTED / PR_OPEN / MERGED` under `repositorySync`. A created PR is not a merged change. Update only that field after sealing; do not rewrite the prepared source SHA to a later PR/merge SHA. Keep the original source patch, tarball integrity and verification history as the next release's provenance. Publication can be verified while repository synchronization is still pending.

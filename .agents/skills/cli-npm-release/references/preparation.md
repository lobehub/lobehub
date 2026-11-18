# Preparation commands and artifact checks

Use these recipes after explicit invocation. Read current scripts every time; these commands are not a substitute for checking the actual build chain. Paths here assume the repository root unless stated otherwise. Never execute `humanPublish.mjs` from an agent.

## Inputs and durable storage

Inspect:

- `AGENTS.md`, `apps/cli/package.json`, `apps/cli/tsdown.config.ts`;
- root and CLI workspace/lock files;
- `apps/cli/scripts/copyReportTemplate.ts`, `apps/workbench/package.json` and its report build script/config;
- `.github/workflows/preview-cli.yml` and build inputs it references.

```bash
git status --short
git branch --show-current
git rev-parse HEAD
node --version
bun --version
pnpm --version
npm --version
npm view @lobehub/cli dist-tags --json --registry=https://registry.npmjs.org
npm view @lobehub/cli@latest version gitHead dist.integrity --json --registry=https://registry.npmjs.org
```

Node must satisfy the package's actual `engines.node`. Query the selected channel too when it differs from stable. Save the registry responses and inspection notes as evidence. Query the confirmed target explicitly; only an explicit version-not-found response proves absence. Do not suppress stderr and call a failed lookup a free version.

After confirming version and tag, initialize a unique durable directory. Set `TARGET` to the confirmed version; do not copy an example version from this document:

```bash
REPO_ROOT="$PWD"
SKILL_DIR="$REPO_ROOT/.agents/skills/cli-npm-release"
RELEASE_DIR="$HOME/.local/share/lobehub/cli-releases/$TARGET-$(date -u +%Y%m%dT%H%M%SZ)"
node "$SKILL_DIR/scripts/release.mjs" init "$RELEASE_DIR"
```

Fill `release.json` using [record.md](record.md). Do not mark anything passed yet. The record and report stay outside Git. If a baseline is unavailable, persist the blocked record rather than continuing into a guessed release.

## Baseline and scope

Verify a full baseline SHA and the evidence connecting it to the published package. Check `git merge-base --is-ancestor`. A previous record must have a matching registry integrity and a `VERIFIED` result, not just a filename/version match. Preserve its source patch:

- Metadata/format-only patches: inspect and account for them explicitly in release notes.
- Behavior-changing patches: reconstruct the actual old source snapshot for comparison; `baselineSHA..HEAD` alone would omit them. If reconstruction is unavailable, block the complete summary.

For a prerelease, include both stable and selected-channel comparisons when different. After provenance is established:

```bash
node "$SKILL_DIR/scripts/release.mjs" scope "$REPO_ROOT" "$BASE_SHA" > "$RELEASE_DIR/scope.json"
```

The helper matches manifest `name`, not arbitrary text mentioning a package, and considers dependencies at both revisions. Its conservative closure includes dev/build dependencies. Inspect reachability to narrow it; absence from a direct import scan is not proof a transitive dependency is unreachable. Also inspect root/build configuration outside that closure as applicable.

Use the recorded `paths` for `git log`, `git diff`, final dirty-input checks and `git diff --binary HEAD -- <release-input-paths...>`. Save the final patch as `release-input.patch`, including both staged and unstaged changes. An empty patch is valid if everything is committed. Untracked release inputs must be explicitly captured or resolved; do not pretend a tracked-only diff contains them. Do not include unrelated local edits or secrets.

Do not upgrade dependencies. Apply only the confirmed CLI version and necessary matching lock metadata with targeted edits. Preserve and review lint autofixes separately. Semantic fixes are new release inputs, not incidental release housekeeping.

## Command receipts and quality gates

The `run` helper launches argv directly, with **no shell**, retains combined stdout/stderr and propagates the actual exit code. It prints relative receipt/log paths under `logs/`. Pass these to gate `runs` and `evidence`; it never sets a gate to `PASS` for you.

```bash
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" lint-tests -- \
  bun run check --lint --test <concrete-affected-source-and-test-paths...>
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" types -- \
  bun run check --type

cd "$REPO_ROOT/apps/cli"
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" bundle-tests -- \
  bunx vitest run --silent=passed-only bundle.test.ts tsdown.config.test.ts vitest.config.test.ts
```

Replace the path placeholder with existing source/test paths from the reviewed release scope, including shared packages. Do not blindly pass deleted files, or omit related tests because only a source file changed. Review all lint autofixes. Do not pipe checks to `tail`/`head`; output truncation must not hide exit status. Inspect logs from their recorded locations.

If dependencies are missing, use pnpm with the committed locks for both root and CLI workspaces, preferably `--frozen-lockfile`. No silent lock regeneration. A type failure remains a failed run, even if apparently pre-existing. Ask before environment repair (including removing generated caches), retain the failed receipt, explain the repair, and record the new run separately. An isolated clean environment is preferable to modifying an active developer environment.

## Acceptance and compatibility

Before new execution, build a coverage table in `report.md`:

| Changed outcome / PR | Required surface | Acceptance evidence and inspected result | Candidate compatibility | Backend environment / deployed evidence |
| -------------------- | ---------------- | ---------------------------------------- | ----------------------- | --------------------------------------- |

Inspect report contents and required artifacts, not just whether a PR has a link. Check later changes to relevant code, dependencies, configuration and environment. Note why evidence remains valid. Reuse completed acceptance; run only gaps under the acceptance skill. An unverified UI outcome cannot be relabeled a CLI-only check.

For each required server contract, name the target backend and prove it is available there. Deployment metadata identifying the relevant revision or a successful real contract interaction can support this. A merge SHA alone cannot. State self-hosted compatibility requirements without implying all installations have upgraded.

A `PASS` in the release record references this table and its underlying evidence. Missing reports/credentials/deployment facts mean `UNKNOWN`, not “probably tested in the PR.” Do not borrow npm credentials or personal product credentials to close a gap.

## Complete publication build

From `apps/cli`:

```bash
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" build -- npm run prepublishOnly
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" built-version -- node dist/index.js --version
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" built-help -- node dist/index.js --help
```

The current lifecycle builds the workbench report, bundles the CLI and maintenance worker, requires/copies the offline report, and generates man pages. Verify the current chain rather than assuming it stays unchanged. The printed version must equal the confirmed target. Reconcile worker extensions with the actual loader reference and build output; do not assume `.js` when the output is `.mjs`.

A missing report, worker, manual, unresolved import or failed build blocks the release. A successful `npm pack` alone does not prove these steps ran.

## Pack and inspect

Still from `apps/cli`, after reviewing any current pack lifecycle scripts:

```bash
node "$SKILL_DIR/scripts/release.mjs" pack "$RELEASE_DIR"
node "$SKILL_DIR/scripts/release.mjs" stamp "$RELEASE_DIR"
```

`pack` calls **only `npm pack`**, writes separate JSON/stderr/exit records and refuses to overwrite an existing pack or handoff. `stamp` derives the filename from `pack.json`, verifies package/version, full integrity and size, and records SHA-256 plus local Node/platform. Neither approves gates or publishes.

Inspect the actual archive listing and packed `package.json`:

- Package name, target version, engines, dependencies, intended public access and registry.
- All declared bin aliases (`lh`, `lobe`, `lobehub`), correct executable shebang and mode.
- Main bundle, current maintenance worker, `dist/acceptance-report.html`, and all declared man pages; inspect manual redirects too.
- No secrets, local credentials, `.env`, private artifacts or unintended files. An eight-file listing alone is not proof the contents contain no secrets.
- No `workspace:`/`file:`/`link:` runtime dependencies; bundled imports must resolve outside the monorepo. Distinguish consumer runtime dependencies from devDependencies.

Retain the listing/inspection results. Use the exact absolute tarball path derived from `release.json`/`pack.json` in all subsequent steps. Never substitute a directory, workspace link or later rebuild.

## Disposable install and smoke

Create a disposable directory **outside** the repo. Inspect runtime dependency install scripts before running installation. Use npm to exercise consumer resolution; do not bypass a failed native install.

```bash
SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lh-cli-smoke.XXXXXX")"
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" install -- \
  npm install --prefix "$SMOKE_DIR" --no-audit --no-fund --registry=https://registry.npmjs.org "$TARBALL"
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" smoke-version -- \
  env LOBEHUB_CLI_HOME="$SMOKE_DIR/home" "$SMOKE_DIR/node_modules/.bin/lh" --version
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" smoke-help -- \
  env LOBEHUB_CLI_HOME="$SMOKE_DIR/home" "$SMOKE_DIR/node_modules/.bin/lh" --help
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" smoke-lobe -- \
  env LOBEHUB_CLI_HOME="$SMOKE_DIR/home" "$SMOKE_DIR/node_modules/.bin/lobe" --version
node "$SKILL_DIR/scripts/release.mjs" run "$RELEASE_DIR" smoke-lobehub -- \
  env LOBEHUB_CLI_HOME="$SMOKE_DIR/home" "$SMOKE_DIR/node_modules/.bin/lobehub" --version
```

Exercise changed command registration/manuals and applicable offline report rendering. For changed native dependencies, exercise actual native terminal behavior in an approved isolated environment; installation alone is not that check. Record actual runtime/platform limits; one macOS smoke is not Linux/Windows verification. Feature acceptance still needs actual affected outcomes, not help output.

Bind these checks to the recorded tarball. If anything changes after packing, use a new preparation directory and repeat affected gates. Keep the immutable prepared artifact and logs; the disposable smoke environment is not the release record.

## Handoff and later verification

Complete the record/report and invoke `handoff` as described in `SKILL.md`. It prints one human-only command with concrete paths. Transfer the whole directory unchanged when publishing elsewhere; on the destination, the human runs `node <transferred-directory>/tools/humanPublish.mjs`. Internal references are relative so the seal survives transfer.

The publisher authenticates independently and handles 2FA. A failed identity check happens before any publish attempt. Once an actual publish is attempted, `publish-attempt.json` prevents blind reruns, even after a nonzero exit or interruption. There is no force/retry bypass. Investigate and resolve registry state first; only a conclusively rejected attempt permits a newly prepared handoff.

After the user reports publication, run read-only `verify`. Each invocation creates a new `verification/<timestamp>.json` with timestamped attempts, observed version/full integrity/tags and final state. Preserve earlier pending/failed observations. If visibility is delayed, keep the existing artifact and wait; never rebuild or publish again just to make the query succeed.

# Patch Release Scenarios

All Patch Release scenarios automatically bump the patch version (e.g. 2.1.31 → 2.1.32). PR titles do not need to include a version number.

## Desktop source binding

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

---

## 1. Weekly Release (canary → main)

The most common release type. Collects a week's worth of changes from canary and ships them to main.

### Steps

1. **Create release branch from canary**

```bash
git checkout canary
git pull origin canary
git checkout -b release/weekly-{YYYYMMDD}
git push -u origin release/weekly-{YYYYMMDD}
```

2. **Scan changes and write changelog**

Compute the previous tag from main first — never reuse the last weekly's tag, since hotfixes published in between will be missed:

```bash
git fetch origin main canary --tags
PREV_TAG=$(git describe --tags --abbrev=0 origin/main --match 'v*.*.*' --exclude '*-canary*' --exclude '*-nightly*')
git log "$PREV_TAG..origin/release/weekly-{YYYYMMDD}" --oneline --no-merges
git diff "$PREV_TAG...origin/release/weekly-{YYYYMMDD}" --stat
```

Then follow `./release-notes-style.md` § **Computing Inputs (Hard Rules)** to derive PR refs, metrics, and contributors. Every `(#XXXX)` in the body must come from actual commit subjects in this range — never inferred from descriptions.

3. **Create PR to main** with the changelog as the PR body

```bash
gh pr create \
  --title "🚀 release: {YYYYMMDD}" \
  --base main \
  --head release/weekly-{YYYYMMDD} \
  --body-file changelog.md
```

4. **While the PR is open**: `release-pr-version.yml` commits `package.json` to latest stable tag + patch.
5. **After merge**: auto-tag-release detects `release/*` branch → tags latest stable tag +1.

---

## 2. Bug Hotfix

Emergency bug fix shipped directly from main.

### Steps

1. **Create hotfix branch from main**

```bash
git checkout main
git pull --rebase origin main
git checkout -b hotfix/v{version}-{short-hash}
git push -u origin hotfix/v{version}-{short-hash}
```

2. **Select a delivered desktop baseline and create PR to main** with a gitmoji prefix title (e.g. `🐛 fix: description`). Prefer `hotfix:branch --base` or add the generated metadata described above; branch name alone does not pin Cloud.

3. **Write a short hotfix changelog** — See `changelog-example/hotfix.md`. Keep it minimal: scope line, 1-3 fix bullets (symptom + fix in one sentence), upgrade note, owner. No long root-cause section — that lives in the commit message.
   - **Hotfix owner**: Use the actual PR author (retrieve via `gh pr view <number> --json author --jq '.author.login'`), never hardcode a username.

4. **While the PR is open**: `release-pr-version.yml` commits `package.json` to latest stable tag + patch.

5. **After merge**: auto-tag-release detects `hotfix/*` branch → tags latest stable tag +1.

### Script

```bash
bun run hotfix:branch --base v2.2.21
```

---

## 3. New Model Launch

New AI model or provider support, typically contributed via community PRs.

### How it works

- Community contributors submit PRs with titles like `✨ feat: add xxx model` or `💄 style: support xxx models`
- These PR title prefixes (`feat` / `style`) are in the auto-tag trigger list
- No special branch naming is required. A main-targeted model patch carries the delivered desktop baseline metadata described above; merging still triggers auto patch +1.

### When an agent is involved

If asked to add model support, just create a normal feature PR. The title prefix will trigger the release automatically.

---

## 4. DB Schema Migration

Database schema changes that need to be released independently. These require a dedicated changelog explaining the migration for self-hosted users.

### Steps

1. **Create release branch from main and cherry-pick migration commits**

```bash
git checkout main
git pull --rebase origin main
git checkout -b release/db-migration-{name}
git cherry-pick <migration-commit-hash>
git push -u origin release/db-migration-{name}
```

2. **Write a migration-specific changelog** — See `changelog-example/db-migration.md` for the format. This should explain:
   - What tables/columns are added, modified, or removed
   - Whether the migration is backwards-compatible
   - Any action required by self-hosted users
   - **Migration owner**: Use the actual PR author (retrieve via `gh pr view <number> --json author --jq '.author.login'` or `git log` commit author), never hardcode a username

3. **Create PR to main** with the migration changelog as the PR body

   Add the generated desktop baseline metadata described above. A `release/db-migration-*` branch is a targeted patch, not a weekly release selecting latest Cloud.

```bash
gh pr create \
  --title "👷 build: {migration description}" \
  --base main \
  --head release/db-migration-{name} \
  --body-file changelog.md
```

4. **While the PR is open**: `release-pr-version.yml` commits `package.json` to latest stable tag + patch.
5. **After merge**: auto-tag-release detects `release/*` branch → tags latest stable tag +1.

# GitHub Release Changelog Standard (Long-Form Style)

Use this guide for **GitHub Release notes** — the body of a release PR that becomes the GitHub Release after merge. Do **not** use it for `docs/changelog/*.mdx` website pages (load `../../docs-changelog/SKILL.md` instead).

## Positioning

This release-note style is:

1. **Data-backed at the top** (date, range, key metrics)
2. **Narrative first, then structured detail**
3. **Deep but scannable** (clear sectioning + compact bullets)
4. **Contributor-forward** (credits are part of the release story)

## Required Inputs Before Writing

Collect these inputs first:

1. Compare range (`<prev_tag>...<current_tag>`)
2. Release metrics (commits, merged PRs, resolved issues, contributors, optional files/insertions/deletions)
3. High-impact changes by domain (core loop, platform/gateway, UX, tooling, security, reliability)
4. Contributor list (with standout contributions if known)
5. Known risks / migrations / rollout notes (if any)

If metrics cannot be reliably computed, omit unknown numbers instead of guessing.

## Computing Inputs (Hard Rules — Verify, Never Guess)

> Hallucinated PR numbers and wrong "Since v..." bases are the #1 failure mode of this skill. Every number and every `(#XXXX)` must come from `git`, never from memory or inference.

### 1. Compare base = latest semver tag on `main`

Do **not** eyeball the tag list or pick the "last weekly" PR. Compute it:

```bash
git fetch origin main canary --tags
PREV_TAG=$(git describe --tags --abbrev=0 origin/main --match 'v*.*.*' --exclude '*-canary*' --exclude '*-nightly*')
echo "$PREV_TAG"
```

Sanity check that the tag is reachable from the release branch:

```bash
git merge-base --is-ancestor "$PREV_TAG" origin/release/weekly-{YYYYMMDD} && echo OK
```

If the check fails, stop and ask the user — the release branch is based on the wrong source.

> **Why not "the last weekly release PR"?** Hotfixes (`v2.1.54`, `v2.1.55`, …) merge directly into main between weeklies. They get back-merged via `sync-main-to-canary`, so the latest semver tag on main _is_ the correct previous release for both weekly and minor flows. Picking the previous weekly's tag will silently undercount and put a stale version in "Since v…".

### 2. PR refs must come from commit subjects — never from descriptions

Compute the canonical set:

```bash
git log "$PREV_TAG..origin/release/weekly-{YYYYMMDD}" \
  --pretty=format:'%s' --no-merges \
  | grep -oE '\(#[0-9]+\)$' \
  | sort -u > /tmp/release_prs.txt
```

Hard rules:

- Every `(#XXXX)` you write in the body **must** appear in `/tmp/release_prs.txt`. No exceptions.
- Never infer a PR number from a feature description. If you remember "the KB BM25 PR was around #14501", that memory is wrong about half the time. Look up the commit hash by feature keyword and read its actual subject.
- If your terminal truncates long subjects (any wrapper that compresses output, e.g. `rtk`), bypass it. With `rtk` use `rtk proxy git log …`. Verify with `wc -l /tmp/release_prs.txt` — the count must match `git log $PREV_TAG..HEAD --no-merges --pretty=format:'%h' | wc -l` minus the few commits without a PR ref. A mismatch of >5% means subjects are being silently truncated.

### 3. Metrics must come from git counts

```bash
PR_COUNT=$(wc -l < /tmp/release_prs.txt | tr -d ' ')

COMMIT_COUNT=$(git log "$PREV_TAG..origin/release/weekly-{YYYYMMDD}" --no-merges --pretty=format:'%h' | wc -l | tr -d ' ')

CONTRIBUTOR_COUNT=$(git log "$PREV_TAG..origin/release/weekly-{YYYYMMDD}" --no-merges --pretty=format:'%an' \
  | sort -u \
  | grep -viE '^(lobehubbot|LobeHub Bot|renovate\[bot\])$' \
  | wc -l | tr -d ' ')
```

If a number cannot be confidently derived, omit it — never guess.

### 4. Author-to-handle resolution

Git `%an` is the commit author display name, not the GitHub handle. For each author you mention, confirm the handle:

```bash
gh pr view "$PR_NUMBER" --repo lobehub/lobe-chat --json author --jq '.author.login'
```

Use the result for `@handle`. Then classify each author per the `LobeHub team roster` below; community first, team after.

### 5. Pre-publish verification (mandatory)

Before `gh pr create` / `gh pr edit --body-file`, diff body PR refs against the canonical set:

```bash
grep -oE '#[0-9]+' release_body.md | sort -u > /tmp/body_prs.txt
sed 's/[()]//g' /tmp/release_prs.txt > /tmp/release_prs_clean.txt

echo "=== In body but NOT in actual range (must be EMPTY) ==="
comm -23 /tmp/body_prs.txt /tmp/release_prs_clean.txt
```

Empty diff = OK. Any output = the body cites a PR that wasn't merged in this range. Stop and fix before publishing.

Also verify the metrics line in the body matches the computed values (`PR_COUNT`, `CONTRIBUTOR_COUNT`) and that `**Full Changelog**` uses `$PREV_TAG`, not some older tag.

## Canonical Structure (Long-Form: Minor / Weekly)

Follow this section order for **Minor** and **Weekly** releases unless the user asks otherwise. For **Hotfix** and **DB Migration**, see § Variants for Shorter Releases below — the canonical structure does not apply.

1. `# 🚀 LobeHub Release (<YYYYMMDD>)`
2. Metadata lines:
   - `Release Date`
   - `Since <Previous Version>` metrics
3. One quoted release thesis (single paragraph, 1-2 lines)
4. `## ✨ Highlights` (6-12 bullets for major releases; 3-8 for weekly)
5. Domain blocks with optional `###` subsections:
   - `## 🏗️ Core Agent & Architecture` (or equivalent product core)
   - `## 📱 Platforms / Integrations`
   - `## 🖥️ CLI & User Experience`
   - `## 🔧 Tooling`
   - `## 🔒 Security & Reliability`
   - `## 📚 Documentation` (optional if meaningful)
6. `## 👥 Contributors`
7. `**Full Changelog**: <prev>...<current>`

Use `---` separators between major blocks for long releases.

## Variants for Shorter Releases

The Canonical Structure above is for **long-form** (Minor / Weekly). Two short-form variants override it.

### Hotfix Variant

A hotfix targets one regression and ships fast. The body is short and operator-focused — no Highlights, no domain blocks, no Contributors line.

Required sections, in order:

1. `# 🚀 LobeHub Release (<YYYYMMDD>)`
2. `**Hotfix Scope:**` — one line summarizing the regression scope (e.g. `Agent topic-switching regression — stale chat state on agent change`). Replaces the long-form `Release Date` / `Since vX.Y.Z` metrics.
3. One quoted thesis (single paragraph, 1-2 lines) describing what is now restored.
4. `## 🐛 What's Fixed` — 1-3 bullets, each `**<symptom>** — <fix in one sentence>. (#PR)`. No root-cause prose; that lives in the commit message.
5. `## ⚙️ Upgrade` — short notes for self-hosted (pull image / restart, schema or env changes) and cloud (usually "applied automatically").
6. `## 👥 Owner` — single `@handle` for the PR author, resolved via `gh pr view "$PR" --json author --jq '.author.login'`. Never hardcoded.

Hard rules specific to hotfix:

- **No Highlights / domain blocks / Contributors / Full Changelog** — these add noise to a one-shot fix.
- **No metric line** — `Since vX.Y.Z` doesn't apply; the body cites the single PR (or 1-3 PRs) directly.
- **Owner ≠ Contributors** — one author, listed under § Owner. Not a flat handle list.
- See `changelog-example/hotfix.md` for the canonical template.

### DB Migration Variant

Database schema changes that need to be released independently. Operator impact is the headline.

Required sections, in order:

1. `# 🚀 LobeHub Release (<YYYYMMDD>)` + scope line
2. **Migration overview** — what tables / columns are added, modified, or removed
3. **Operator impact** — backwards-compatible? required actions for self-hosted?
4. **Rollback / backup note** — how to recover
5. `## 👥 Owner` — single PR author, resolved via `gh pr view`

See `changelog-example/db-migration.md` for the canonical template.

## Writing Rules (Hard)

1. **No fabricated metrics**: all numbers must be traceable.
2. **No vague headline bullets**: each bullet must include capability + impact.
3. **No internal-only framing**: phrase from user/operator perspective.
4. **Security must be explicit** when security-sensitive fixes are present.
5. **PR/issue linkage**: use `(#1234)` when IDs are available.
6. **Terminology consistency**: same feature/provider name across sections.
7. **Do not bury migration or breaking changes**: elevate to dedicated section or callout.

## Style Rules (Long-Form)

1. Start with an "everyday use" framing, not implementation internals.
2. Mix narrative sentence + evidence bullets.
3. Keep bullets compact but informative:
   - Good: `**Fast Mode (`/fast`)** — Priority routing for OpenAI and Anthropic, reducing latency on supported models. (#6875, #6960)`
4. Use bold only for capability names, not for whole sentences.
5. Keep heading depth ≤ 3 levels.

## Release Size Heuristics

- **Minor / major milestone release**
  - Long-form structure with multiple domain blocks.
  - `Highlights` usually 8-12 bullets.
- **Weekly patch release**
  - Long-form skeleton with reduced subsection count.
  - `Highlights` usually 4-8 bullets.
- **Hotfix release**
  - Short-form (see § Variants → Hotfix). No Highlights, no domain blocks, no Contributors.
  - 1-3 fix bullets. Body should fit on one screen.
- **DB migration release**
  - Short-form (see § Variants → DB Migration).
  - Must include `Migration overview`, operator impact, and rollback/backup note.

## Contributor Ordering

Render contributors as a **single flat list** (no separate "Community" / "Core Team" subsections). Order: **community contributors first, team members after**. Within each group, sort by PR count desc. Bots (`@lobehubbot`, `renovate[bot]`) go on a separate "maintenance" line.

**LobeHub team roster** — anyone in this list is a team member; anyone not in this list is a community contributor:

- @arvinxx
- @Innei
- @tjx666 (commit author name: YuTengjing)
- @LiJian
- @Neko
- @Rdmclin2
- @AmAzing129
- @sudongyuer (commit author name: Tsuki)
- @rivertwilight (commit author name: René Wang)
- @CanisMinor
- @cy948 (commit author name: Rylan Cai)

> **Resolving handles** — git author names (e.g. `YuTengjing`) are not always the GitHub handle. Verify via `gh pr view "$PR" --json author` or `gh api search/users -f q='<email>'` before listing.

If a new contributor appears who is not on this list, treat them as community by default and ask the user whether to add them to the roster.

## Template

```md
# 🚀 LobeHub Release (<YYYYMMDD>)

**Release Date:** <Month DD, YYYY>  
**Since <Previous Version>:** <N merged PRs> · <N resolved issues> · <N contributors>

> <One release thesis sentence: what this release unlocks in practice.>

---

## ✨ Highlights

- **<Capability A>** — <What changed and why it matters>. (#1234)
- **<Capability B>** — <What changed and why it matters>. (#2345)
- **<Capability C>** — <What changed and why it matters>. (#3456)

---

## 🏗️ Core Product & Architecture

### <Subdomain>

- <Concrete change + impact>. (#...)
- <Concrete change + impact>. (#...)

---

## 📱 Platforms / Integrations

- <Platform update + impact>. (#...)
- <Compatibility/reliability fix + impact>. (#...)

---

## 🖥️ CLI & User Experience

- <User-facing workflow improvement>. (#...)
- <Quality-of-life fix>. (#...)

---

## 🔧 Tooling

- <Tool/runtime improvement>. (#...)

---

## 🔒 Security & Reliability

- **Security:** <hardening or vulnerability fix>. (#...)
- **Reliability:** <stability/performance behavior improvement>. (#...)

---

## 👥 Contributors

Huge thanks to **<N contributors>** who shipped **<N merged PRs>** this cycle.

@<community-handle> · @<community-handle> · @<team-handle> · @<team-handle>

Plus @lobehubbot and renovate[bot] for maintenance.

---

**Full Changelog**: <previous_tag>...<current_tag>
```

## Quick Checklist

### Long-Form (Minor / Weekly)

- [ ] `PREV_TAG` is `git describe --tags --abbrev=0 origin/main` (latest semver), not the last weekly's tag
- [ ] Every `(#XXXX)` in the body appears in `/tmp/release_prs.txt` (verified via `comm -23`)
- [ ] `Since v…` line uses `$PREV_TAG`; PR / contributor counts match `wc -l` on the computed sets
- [ ] `**Full Changelog**` uses `$PREV_TAG...release/weekly-<YYYYMMDD>` (or `…v{x.y.z}` for minor)
- [ ] Author handles resolved via `gh pr view --json author`, not assumed from `%an`
- [ ] Uses top metadata and a clear release thesis
- [ ] Includes `Highlights` plus domain-grouped sections
- [ ] Every major bullet states both change and user/operator impact
- [ ] Security and reliability updates are explicitly surfaced (when present)
- [ ] Contributor credits and compare range are included
- [ ] All numbers and claims are verifiable

### Hotfix

- [ ] `**Hotfix Scope:**` line replaces metrics line
- [ ] Single quoted thesis describes what is restored (operator-facing, not internal)
- [ ] `## 🐛 What's Fixed` has 1-3 bullets, each `**<symptom>** — <fix>. (#PR)` with PR ref verified to exist and be merged
- [ ] `## ⚙️ Upgrade` notes self-hosted action and cloud auto-apply
- [ ] `## 👥 Owner` is a single `@handle` resolved via `gh pr view "$PR" --json author`
- [ ] No Highlights / domain blocks / Contributors / Full Changelog included

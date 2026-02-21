# Patch Release Scenarios

All Patch Release scenarios automatically bump the patch version (e.g. 2.1.31 → 2.1.32). PR titles do not need to include a version number.

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

```bash
git log main..canary --oneline
git diff main...canary --stat
```

Write a user-facing changelog following the format in `patch-release-changelog-example.md`.

3. **Create PR to main** with the changelog as the PR body

```bash
gh pr create \
  --title "🚀 release: {YYYYMMDD}" \
  --base main \
  --head release/weekly-{YYYYMMDD} \
  --body-file changelog.md
```

4. **After merge**: auto-tag-release detects `release/*` branch → auto patch +1.

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

2. **Create PR to main** with a gitmoji prefix title (e.g. `🐛 fix: description`)

3. **After merge**: auto-tag-release detects `hotfix/*` branch → auto patch +1.

### Script

```bash
bun run hotfix:branch
```

---

## 3. New Model Launch

New AI model or provider support, typically contributed via community PRs.

### How it works

- Community contributors submit PRs with titles like `✨ feat: add xxx model` or `💄 style: support xxx models`
- These PR title prefixes (`feat` / `style`) are in the auto-tag trigger list
- No special branch naming or manual release steps required — merging the PR triggers auto patch +1

### When Claude is involved

If asked to add model support, just create a normal feature PR. The title prefix will trigger the release automatically.

---

## 4. DB Schema Migration

Database schema changes that need to be released independently. These require a dedicated changelog explaining the migration for self-hosted users.

### Steps

1. **Create release branch from canary**

```bash
git checkout canary
git pull origin canary
git checkout -b release/db-migration-{name}
git push -u origin release/db-migration-{name}
```

2. **Write a migration-specific changelog** — See `db-migration-changelog-example.md` for the format. This should explain:
   - What tables/columns are added, modified, or removed
   - Whether the migration is backwards-compatible
   - Any action required by self-hosted users

3. **Create PR to main** with the migration changelog as the PR body

```bash
gh pr create \
  --title "👷 build: {migration description}" \
  --base main \
  --head release/db-migration-{name} \
  --body-file changelog.md
```

4. **After merge**: auto-tag-release detects `release/*` branch → auto patch +1.

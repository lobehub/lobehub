# Minor Release Workflow

Used to publish a new minor version (e.g. `v2.2.0`), roughly every 4 weeks. The PR title carries the exact version number; CI parses it to drive the rest of the release.

## Steps

1. **Create a release branch from canary**

   ```bash
   git checkout canary
   git pull origin canary
   git checkout -b release/v{version}
   git push -u origin release/v{version}
   ```

2. **Determine the version number** — Read the current version from `package.json` and compute the next minor version (e.g. `2.1.x` → `2.2.0`).

3. **Create a PR to main**

   ```bash
   gh pr create \
     --title "🚀 release: v{version}" \
     --base main \
     --head release/v{version} \
     --body-file release_body.md
   ```

   > \[!IMPORTANT]
   > The PR title must strictly match the `🚀 release: v{x.y.z}` format. CI uses a regex on this title to determine the exact version number.

4. **Write the PR body as release notes** — Follow `release-notes-style.md`. Compare base is the latest semver tag on main (`git describe --tags --abbrev=0 origin/main`).

5. **Automatic trigger after merge** — `auto-tag-release` detects the title format, uses the version number from the title, bumps `package.json`, tags `v{x.y.z}`, creates the GitHub Release, and dispatches `sync-main-to-canary`.

## Scripts

```bash
bun run release:branch         # Interactive
bun run release:branch --minor # Directly specify minor
```

## Hard Rules (specific to Minor)

- PR title format is **strict**: `🚀 release: v{x.y.z}`. Any deviation falls through to patch detection.
- Do **NOT** manually modify `package.json` version — CI will bump it.
- Do **NOT** manually create the tag — CI will tag.
- Highlights bullet count is usually 8–12 (see `release-notes-style.md` size heuristics).

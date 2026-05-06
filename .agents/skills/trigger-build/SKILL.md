---
name: trigger-build
description: "Trigger build workflow in hardy-one/lobe-release after pushing to origin. Use when user says 'trigger build', 'build', '触发构建', or after pushing code to origin."
user-invocable: true
---

# Trigger Build in lobe-release

## Overview

After pushing code to origin, trigger the build workflow in the `hardy-one/lobe-release` repository to start the build process.

## Steps

### 1. Get current branch

```bash
git branch --show-current
```

### 2. Push to origin (if not already pushed)

```bash
git push origin $(git branch --show-current)
```

If the branch has upstream set, use:

```bash
git push origin $(git branch --show-current)
```

### 3. Trigger build workflow

```bash
gh workflow run build-all.yml --repo hardy-one/lobe-release --ref $(git branch --show-current)
```

### 4. Verify workflow triggered

```bash
gh run list --repo hardy-one/lobe-release --limit 1
```

Show the user the workflow run URL.

## Notes

- The workflow will run in `hardy-one/lobe-release` repository
- Uses the current branch name as the ref for the workflow
- User must have proper permissions to trigger workflows in the target repository
- If workflow trigger fails with 403, user may need to check their permissions or use GitHub token

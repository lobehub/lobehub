# Dependency patches

This directory holds `pnpm patch` overrides for dependencies that ship bugs we
need fixed before the next upstream release.

## `@upstash/qstash` (`patches/@upstash__qstash.patch`)

The patch fixes two things in the bundled `HttpClient` / `AutoExecutor`:

1. Surface a useful message from thrown errors instead of `[object Object]`
   (`Error submitting steps to QStash ...: ${error}` → `error.message`).
2. Log non-2xx responses to help trace publish failures (e.g. HTTP 400).

**Why this is fragile**

`@upstash/qstash` is published as a single bundled ESM where the patched code
lives inside a build-hashed chunk (e.g. `chunk-JYPXGFWX.mjs`). The hash changes
on every publish, so the moment `@upstash/qstash` is bumped the patch stops
matching and `pnpm install` fails with a "patch did not apply" error.

**Regenerating on a version bump (do NOT hand-edit the hash)**

Requires an installed workspace (`pnpm install`) first — `pnpm patch` fails with
`ERR_PNPM_PATCH_NO_LOCKFILE` otherwise.

```bash
pnpm patch @upstash/qstash
# → prints the extracted directory, e.g.
#   node_modules/.pnpm_patches/@upstash/qstash@2.11.3
# edit the extracted file, then:
pnpm patch-commit "node_modules/.pnpm_patches/@upstash/qstash@2.11.3" --patches-dir patches
```

Note there is no `-o`/`--output` flag: `patch-commit` takes the directory as a
positional arg and `--patches-dir` selects the *directory* to write to. The
filename (`@upstash__qstash.patch`) is derived automatically.

Two gotchas:

- `pnpm patch` extracts the package **with the existing patch already applied**,
  so edit only the delta. Do not re-apply the old patch by hand — GNU `patch`
  will report "Reversed (or previously applied) patch detected" and, if
  interrupted, leaves a stray `chunk-XXXXXX.mjs.<random>` backup that then gets
  baked into the regenerated patch as an empty new file.
- Verify the result round-trips before committing:

  ```bash
  cp node_modules/.pnpm/@upstash+qstash@*/node_modules/@upstash/qstash/chunk-*.mjs /tmp/check/
  cd /tmp/check && git apply -R -p1 <repo>/patches/@upstash__qstash.patch  # revert
  git apply -p1 <repo>/patches/@upstash__qstash.patch                      # re-apply
  ```

Keep the patch as small as possible (only the two changes above) so it keeps
applying across minor versions. If a future `@upstash/qstash` release fixes the
error-message extraction upstream, drop this patch entirely.

# D dependency incident and installation boundary

## Preserved incident evidence

- Trigger: from D's worktree with its isolated service environment, `.agents/acceptance/scripts/init-dev-env.sh qstash`; the helper invokes `pnpm run qstash -- -port 58080`.
- Time evidence: `.acceptances/hooks-d-phase1/assets/qstash-dev.log` creation `2026-09-28T17:22:21+08:00`, last write `17:22:34+08:00`. These are filesystem bounds for the captured log, not a separately recorded shell start/end timestamp.
- Observed failure: pnpm expanded to all 119 workspace projects and failed with `ERR_PNPM_CMD_SHIM_CREATE_BIN_DIR` at D's `packages/achaos/runner/node_modules/.bin`, `File exists (os error 17)`.
- Exit information: installation failed; the preserved log does not contain the process's numeric exit code. It was not separately retained. OS error 17 is not a shell exit code. Do not rerun the unsafe command to recover that number.
- Candidate affected paths at that time: root checkout `/Users/wangxuan/Documents/PProjects/lobehub/node_modules/.pnpm` and `.bin`, reached through D's initial links; pnpm's logged shared content-addressable store `/Users/wangxuan/Library/pnpm/store/v11`; D's own workspace dependency links, including the failing `.bin` above. The log does not establish an exact changed-file inventory in the shared stores.
- Coordinator subsequently reports root canary source `git status` clean and C2 instructed to pin its dependency snapshot before same-environment comparisons. Clean source does not prove an unchanged dependency store. D has not rolled back or deleted any shared store.

The initial layout is retained in `assets/dependency-layout.json`; the APFS clone/relink checkpoint is in `assets/dependency-isolation.json` (historical intermediate dangling links were subsequently repaired). Current checks are in `.acceptances/hooks-d-env2/dependencies.json`, `workspace-resolution.jsonl` and `install-boundary-check.json`.

## Current runtime layout

Root `.pnpm`, `.bin` and standalone CLI dependencies are local D directories. All 112 recorded workspace package links resolve to D source; runtime/types/database were also resolved from root, server and CLI contexts. Shared source worktrees were not integrated. The prepared dependency graph is retained for the eventual final-base/current diagnostic comparison.

QStash now starts from a D-owned APFS copy of the installed official 2.37.18 arm64 binary, with no package manager or automatic installation:

```bash
./.records/bin/hooks-d-qstash-2.37.18 dev -port 58080
```

SHA-256: `1d77b39cd188208e144aeaad07a9aa6e184a7375467d0df9b44c0fbf2042c58c`. Original cached binary was read/copied, not modified. This launch was verified with publish HTTP 201 and actual receiver arrival in 1082 ms; evidence is `queue-owned-binary-health.json` and `queue-owned-binary-receiver.jsonl`. The dedicated binary was then stopped after PID/command/cwd checks. This remains local simulator infrastructure evidence.

Do not call the QStash helper's `qstash` subcommand or use repository `pnpm run`/`dlx` to start it. Existing S3/app helpers and the installed gateway executables do not need a fresh install.

## Future installation boundary

No further package installation is scheduled for the prepared environment. Before any necessary install, select a D-owned target with its own manifest/workspace boundary and load `.records/env/hooks-d-install.env`. It redirects pnpm home/store/cache/state/global directories, npm cache, Corepack home, Bun cache and XDG directories beneath D's `.records/install-isolation`. Never install through a dependency symlink into another checkout, and do not reinstall the pinned product graph during final same-environment comparison.

A locally copied pnpm 10.13.1 executable is available at `.records/install-isolation/tooling/pnpm-10.13.1/bin/pnpm.cjs`. With the profile loaded, its version and resolved store/cache/state settings were queried and confirmed inside D. Automatic package-manager switching is disabled in that profile. This is a verified installer configuration, not a requirement to downgrade another package's declared manager; provision any required version in D's own tooling/cache first.

```bash
source .records/env/hooks-d-install.env
node .records/install-isolation/tooling/pnpm-10.13.1/bin/pnpm.cjs --version
node .records/install-isolation/tooling/pnpm-10.13.1/bin/pnpm.cjs config get store-dir
node .records/install-isolation/tooling/pnpm-10.13.1/bin/pnpm.cjs config get cache-dir
node .records/install-isolation/tooling/pnpm-10.13.1/bin/pnpm.cjs config get state-dir
```

Do not assume the system pnpm 12 accepts the same cache flags or environment settings: its config queries returned undefined and `--cache-dir` was rejected. These read-only/configuration attempts did not run installation. Use the verified configuration above, or validate a different manager's paths before mutation. Earlier gateway installs used ordinary shared package caches; those caches remain untouched by cleanup. All future install writes are constrained to D or a dedicated temporary directory.

## Environment handoff remains current

`environment-step2.md` already records verified app/login, queue target receipt, S3, SQL/Redis, official local gateway auth and actual device marker write/read. Those results are not rerun merely to acknowledge this incident update. Managed-QStash credentials/public target and a real model endpoint/key/model remain the external gaps. Hook acceptance remains 0/31 pending the coordinator's integrated base.

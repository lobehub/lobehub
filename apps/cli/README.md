# @lobehub/cli

LobeHub command-line interface.

## Acceptance skill

The acceptance skill is maintained in [lobehub/acceptance](https://github.com/lobehub/acceptance).
Install from the repository's default branch:

```bash
lh acceptance install
```

Update the installed skill:

```bash
lh acceptance update
```

Creating acceptances and publishing reports require authentication. Run `lh login`
before using those commands.

This selects the same source as `npx skills add lobehub/acceptance --skill acceptance`.
Changes merged into the default branch are available on the next install or
update, without a tag, GitHub Release, or skill-version bump. Installed files
remain unchanged until you run an update.

`install` skips existing files unless `--force` is passed. `update` replaces the
materialized files in `.agents/skills/acceptance`, removes stale resources, and
maintains agent links. The server resolves a commit and downloads the entire
skill from that snapshot before files are changed. `--json` reports the exact
source commit and the version declared in `SKILL.md`; that version is a label,
not the selector for default updates.

Use an up-to-date CLI and LobeHub server. Older servers may return `401` during
installation and need to be upgraded.

To select an existing version tag explicitly, use `lh acceptance update --skill-version 0.5.0` (requires the updated CLI and server), or the equivalent
[tagged skill source](https://github.com/lobehub/acceptance/tree/v0.5.0/skills/acceptance)
with `npx skills add`. A later `lh acceptance update` without `--skill-version`
returns to the current default-branch source.

## Local Development

| Task                                       | Command                    |
| ------------------------------------------ | -------------------------- |
| Run in dev mode                            | `bun run dev -- <command>` |
| Build the CLI                              | `bun run build`            |
| Link `lh`/`lobe`/`lobehub` into your shell | `bun run cli:link`         |
| Remove the global link                     | `bun run cli:unlink`       |

- `bun run build` only generates `dist/index.js`.
- To make `lh` available in your shell, run `bun run cli:link`.
- After linking, if your shell still cannot find `lh`, run `rehash` in `zsh`.

## Custom Server URL

By default the CLI connects to `https://app.lobehub.com`. To point it at a different server (e.g. a local instance):

| Method               | Command                                                         | Persistence                         |
| -------------------- | --------------------------------------------------------------- | ----------------------------------- |
| Environment variable | `LOBEHUB_SERVER=http://localhost:4000 bun run dev -- <command>` | Current command only                |
| Login flag           | `lh login --server http://localhost:4000`                       | Saved to `~/.lobehub/settings.json` |

Priority: `LOBEHUB_SERVER` env var > `settings.json` > default official URL.

## Provider-bound Codex on a connected device

A personal `lh connect` connection can execute a Codex agent configured with an API provider. Select that device in the product UI and send normally. The server and connector must both support the provider-bound dispatch protocol; older connectors reject the request instead of using their subscription login.

The connector resolves the selected, enabled provider and model using its current personal authentication. It uses an isolated Codex profile and environment, while the child process receives operation-scoped authentication for reporting. Provider keys are not included in gateway requests or command-line arguments. A follow-up resumes only when its saved session belongs to the same binding; changing bindings starts a new native session with the conversation context.

Use this path for personal Codex API bindings on a selected device with a live CLI connection. A Desktop-only connection does not support this RPC. The connector must include provider-bound execution support; older versions reject the request instead of using native credentials. Unused binding profiles follow the shared 30-day cleanup policy. Workspace connections, deployment-default API bindings, and other heterogeneous runtimes do not support this device path. Desktop local execution keeps its existing provider support. The API model controls the run without overwriting a Topic's saved native model pin.

## Shell Completion

### Install completion for a linked CLI

| Shell  | Command                        |
| ------ | ------------------------------ |
| `zsh`  | `source <(lh completion zsh)`  |
| `bash` | `source <(lh completion bash)` |

### Use completion during local development

| Shell  | Command                                      |
| ------ | -------------------------------------------- |
| `zsh`  | `source <(bun src/index.ts completion zsh)`  |
| `bash` | `source <(bun src/index.ts completion bash)` |

- Completion is context-aware. For example, `lh agent <Tab>` shows agent subcommands instead of top-level commands.
- If you update completion logic locally, re-run the corresponding `source <(...)` command to reload it in the current shell session.
- Completion only registers shell functions. It does not install the `lh` binary by itself.

## Quick Check

```bash
which lh
lh --help
lh agent <TAB>
```

## Tests

The default `test` and `test:coverage` scripts run offline unit tests only. Live
E2E uses a separate config and never replaces or removes your selected CLI home.
It always runs this checkout's `dist/index.js`, not a globally installed `lh` or
a caller-supplied `LH_CLI_PATH`.

From `apps/cli`, prepare a dedicated test account (never your everyday account):

```bash
bun run build
export LOBEHUB_CLI_HOME=.lobehub-e2e
export LOBEHUB_SERVER=https://your-test-server.example
node dist/index.js login --server "$LOBEHUB_SERVER"
node dist/index.js whoami

# Explicitly authorize real writes for this test account/server.
export LOBEHUB_E2E_ALLOW_WRITES=1
bun run test:e2e e2e/model.e2e.test.ts --testTimeout=60000 --hookTimeout=60000
```

Without a selected home, server, write opt-in, built CLI, or valid authentication,
the live setup fails before fixture creation. A directory name does not itself
isolate server data: sign in with a dedicated test identity. Model tests own a
temporary provider, including the remote-model clearing case. Other suites may
create data or consume model credits, so do not run them on a personal account.
Collection alone (`bunx vitest list --config vitest.e2e.config.mts`) needs no login.
Signal and VFS tests additionally require their documented Agent ID variables.
Search fixtures wait up to 60 seconds for asynchronous indexing; a timeout fails
the suite rather than accepting empty results. The command above supplies a live
network budget explicitly; this does not change unit-test timeouts or enable retries.

Provider-bound device dispatch probes the connection protocol before sending. Freeform `LOBEHUB_CLI_CHANNEL` labels, including `cli-dev`, are routed through the label that answered the probe; older connectors and Desktop-only connections remain unavailable.

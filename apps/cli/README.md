# @lobehub/cli

LobeHub command-line interface.

## Acceptance skill

The acceptance skill is maintained in [lobehub/acceptance](https://github.com/lobehub/acceptance).
Sign in, then install or update its latest stable GitHub release:

```bash
lh login
lh acceptance install
lh acceptance update
lh acceptance update --skill-version 0.5.0
```

`install` skips existing files unless `--force` is passed. `update` replaces the
materialized files in `.agents/skills/acceptance`, removes stale resources, and
maintains agent links. The complete release is downloaded and validated before
existing files are changed. `--json` reports the skill version and source commit;
the skill version is independent of the CLI version.

All CLI versions use the authenticated `verify.getSkillBundle` endpoint. After
deploying the server adapter, already-published CLIs receive the latest stable
release without an upgrade. Selecting a version with `--skill-version` requires
both the updated CLI and server. Creating acceptances and publishing reports
use the same login.

General skill installers can use the [tagged skill directory](https://github.com/lobehub/acceptance/tree/v0.5.0/skills/acceptance) to select the same source. Avoid mixing unpinned branch installs and release-based updates in the
same directory: `lh acceptance update` intentionally restores the stable release.

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

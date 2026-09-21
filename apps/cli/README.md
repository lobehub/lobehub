# @lobehub/cli

LobeHub command-line interface.

## Acceptance skill

The acceptance skill is maintained in [lobehub/acceptance](https://github.com/lobehub/acceptance).
After signing in, install or update from the repository's default branch:

```bash
lh login
lh acceptance install
lh acceptance update
```

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

All CLI versions use the authenticated `verify.getSkillBundle` endpoint. After
the server adapter is deployed, already-published CLIs follow the default branch
without upgrading. Creating acceptances and publishing reports use the same login.

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

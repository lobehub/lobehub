# CLI (`lobe-design` / `lhd`) — agents guide

> CLI binary: **`lobe-design`** (short alias **`lhd`**). Do **not** use `ld` — it conflicts with the system linker (`/usr/bin/ld`).

<!-- refs:meta
tier: flat
scope: lobe-design CLI usage for agents
-->

Agents use the **`lobe-design`** binary (short alias **`lhd`**) to talk to the Lobe Design
archive at [design.lobe.li](https://design.lobe.li): search / fetch design outputs
(`mock` = 设计产出) and inspiration (`case` = 设计灵感), and optionally create /
update /delete entries. Prefer `lobe-design` over inventing curl against `/api/trpc`.

**Before any create / upload:** apply archive **门禁** — condensed below; full text in
[`lobe-design-cli/references/gates.md`](../../lobe-design-cli/references/gates.md)
(also summarized in the `lobe-design-cli` skill).

## When to use

Either command name works: `lobe-design` or short alias `lhd`.

| Goal                                          | Command                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Find similar UI / patterns                    | `lobe-design search "<query>"`                                                                                      |
| List recent / filtered entries                | `lobe-design list --kind mock\|case`                                                                                |
| Open one entry by id                          | `lobe-design get <id>`                                                                                              |
| Install this skill + CLI skill into a project | `lobe-design skill install --dir <project>/.agents/skills`                                                          |
| Auth once per machine (writes + mock reads)   | Members: `lobe-design auth login`. Existing token logins stay signed in. Automation may use `--token` / `LD_TOKEN`. |

Do **not** put Neon / R2 secrets in the agent environment.
Reading 设计灵感 (`list` / `search` / `get` with `--kind case`) does **not** need
a token. Reading 设计产出 (`mock`) and all write commands still require a CLI
login. Members should run `lobe-design auth login` and approve in the browser
(authorizes on <https://design.lobe.li>). Previously saved tokens stay signed in.
Automation may use `--token` / `LD_TOKEN` / `DESIGN_CLI_TOKEN`.

## Auth (CLI-01)

```bash
# members, first-time or to switch accounts
lobe-design auth login
lobe-design auth status
lobe-design auth logout

# automation / CI (optional)
lobe-design auth login --token "$DESIGN_CLI_TOKEN"
```

Credentials: `~/.config/lobe-design/config.json` (`0600`). Existing token logins
keep working with no re-login. Overrides: `LD_TOKEN`, `LD_BASE_URL` (API default
`https://design.lobe.li`). Device login authorizes on `https://design.lobe.li`;
`--base-url` does not change that. `auth logout` revokes a personal device
session on the server; it only clears a shared automation token locally.

Personal device sessions last 30 days. Active use renews the expiry only after
the server can refresh LobeHub credentials and confirm workspace membership.
To enable renewal, sign in again at <https://design.lobe.li/login>, consent to
`offline_access`, then run `lobe-design auth login`. If refresh credentials are
rejected, sign in again. Static token logins are unchanged.

## Read (CLI-02)

`--kind case` (设计灵感 list /search/get) works without logging in.
`--kind mock` and `get --tracing` still need a token. Default `--kind=all`
without a token returns only 设计灵感 and skips 设计产出.

```bash
lobe-design search "sidebar"
lobe-design search "drawer" --kind case --tag 导航
lobe-design search --kind mock --topic infra --sort rating-desc --json

lobe-design list --kind mock
lobe-design list --kind case --limit 20 --json

lobe-design get <id>
lobe-design get <id> --kind mock --related --tracing --json
```

Default search `--kind=all` covers both 设计产出 and 设计灵感.

## Write (CLI-03)

Only when the user explicitly asked to mutate the archive. Schemas match the site
DB / design-archive JSON. Media is converted locally (images → WebP, video → WebM
via `ffmpeg`) then uploaded through server presigned URLs. CDN:
`https://design.lobeobjects.space`.

```bash
lobe-design create ./entry.json --kind mock --media-dir /path/to/design-archive
lobe-design update ./entry.json --kind case --media-dir /path/to/design-archive
lobe-design upload ./entry.json --kind mock --media-dir /path/to/design-archive # upsert
lobe-design create ./entry.json --kind mock --media-dir ./ --dry-run
lobe-design delete < id > --yes
```

### 门禁 / Gates (CLI-03a) — condensed

Full gates: [`../../lobe-design-cli/references/gates.md`](../../lobe-design-cli/references/gates.md).

| Topic       | Rule                                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kinds       | `mock` = 设计产出 (STAR+tracing+rating); `case` = 设计灵感 (curated refs). Browse UI shows only these two; raw/rejected stay off UI.                                                          |
| Case admit  | Learnable product/UI, landing/pricing comps, method covers/redlines, photo→finished contrasts, magazine design cards. Quality ≈ #design / #case-room, not channel-gated.                      |
| Case reject | Complaints/naming rants, eng bug dumps, #dev likes alone, LobeHub own promo, agent workflow demos, real-person photos, isolated IP/mascot stills, booth/hardware snaps. Use `tier: rejected`. |
| Case fields | Bilingual title+tags (zh in UI); title=object+pattern; tags 5–12 fine; `core`+`summary`+`why_good`; `tier: curated` + `case_admit: design_ref` when admitted; `sources` with original URL.    |
| Mock split  | One entry per **case dimension** (not per Discord thread). E.g. 脸型矩阵 vs 状态环 = two mocks.                                                                                               |
| Mock assets | Stage-OK directions → final album; weak drafts → tracing. Cover 「n 图」= final count. `status`: shipped\|iterating\|rejected\|superseded.                                                    |
| STAR        | Concrete zh prose: situation / task / action / result — no slogans.                                                                                                                           |
| 好 / 差     | `problems[]` as `{problem,solution?}` or strings; `rating_pros`/`rating_cons` + `rating_reason`.                                                                                              |
| Rating      | 0–5 on mocks when context exists; stars-only in UI; always `rating_reason`. 5=clear win · 4=solid · 3=mixed · 1–2=weak · 0=wrong.                                                             |
| Tracing     | Full related-people chat (Discord + Grok Bot when relevant); avatars; resolve @ to usernames; chat-sized images; use `discord.messages` / thread ids / urls.                                  |

Block create/upload if the pre-flight checklist in gates.md fails.

## Skill install (CLI-04)

Install **both** canonical skills into an agent skills directory (symlink by
default, same idea as repo `./install.sh`):

- `lobe-design` — UI design pipeline skill
- `lobe-design-cli` — how agents operate `lobe-design` (+ archive gates)

```bash
# into a host project
lobe-design skill install --dir /path/to/project/.agents/skills

# user-global agent dirs
lobe-design skill install --claude
lobe-design skill install --cursor
lobe-design skill install --all
lobe-design skill install --copy --dir /path/to/project/.agents/skills
lobe-design skill list --dir /path/to/project/.agents/skills
lobe-design skill uninstall --dir /path/to/project/.agents/skills
```

Source resolution order: `--from <repoRoot>` → walk from cwd / CLI package for
`skills/lobe-design/SKILL.md` → cache clone of `lobehub/lobe-design-skill`.

## Help (CLI-05)

```bash
lobe-design --help
lobe-design help search
lobe-design skill --help
```

## Agent discipline (CLI-06..CLI-08)

- **CLI-06** Prefer `--json` when parsing programmatically; never scrape human tables.
- **CLI-07** Do not invent archive ids; search/list first, then `lobe-design get`.
- **CLI-08** Destructive commands require the user's explicit request and `--yes`.
- **CLI-03a** Admission gates above are mandatory before create/upload.

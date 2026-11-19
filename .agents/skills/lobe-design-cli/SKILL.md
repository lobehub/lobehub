---
name: lobe-design-cli
version: 0.2.0
description: >
  How agents use the Lobe Design CLI (`lobe-design` / `lhd`) against design.lobe.li:
  auth (browser device login or optional DESIGN_CLI_TOKEN), search/list/get for 设计产出 (mock) and 设计灵感 (case), optional CRUD
  with local media conversion, archive admission gates before create/upload, and
  `lobe-design skill install` to wire lobe-design + this skill into a project.
  Trigger on lhd, lobe-design, lobe-design-cli, design.lobe.li CLI, auth login, DESIGN_CLI_TOKEN,
  archive search, 设计产出, 设计灵感, skill install, 门禁, curated, STAR.
---

> CLI binary: **`lobe-design`** (short alias **`lhd`**). Do **not** use `ld` — it conflicts with the system linker (`/usr/bin/ld`).

# lobe-design-cli

Operate the **Lobe Design archive** from the terminal. Full design-system pipeline
lives in the sibling skill **`lobe-design`**; this skill covers the `lobe-design` tool
**and the admission gates agents must pass before mutating the archive**.

Canonical deep dive (also linked from lobe-design): `skills/lobe-design/references/cli.md`.
**Full gates:** [references/gates.md](references/gates.md) — read before every create/upload.

## Install skills into a project

```bash
lobe-design skill install --dir < project > /.agents/skills
# or: --claude / --codex / --cursor / --agents / --all
# snapshot instead of symlink: --copy
```

This installs **both** `lobe-design` and `lobe-design-cli`. Equivalent bash entry:
repo-root `./install.sh` (now also links this skill when present).

## Auth

Members sign in with `lobe-design auth login` (browser, <https://design.lobe.li>).
Previously saved tokens remain valid. Automation may use `--token` or `LD_TOKEN`.
Personal device sessions last 30 days and renew on active use after server-side
credential refresh and membership checks. First sign in again at
<https://design.lobe.li/login> and consent to `offline_access`, then run
`lobe-design auth login`. Reauthenticate if refresh credentials are rejected.
Static token logins are unchanged.

```bash
lobe-design auth login
lobe-design auth status
lobe-design auth logout

# automation / CI (optional)
lobe-design auth login --token "$DESIGN_CLI_TOKEN"
```

## Read / write cheatsheet

```bash
lobe-design search "sidebar" --kind all
lobe-design list --kind mock --json
lobe-design get --json < id > --related

lobe-design create ./entry.json --kind mock --media-dir ./design-archive
lobe-design update ./entry.json --kind case --media-dir ./design-archive
lobe-design upload ./entry.json --kind mock --media-dir ./design-archive
lobe-design delete < id > --yes
```

Kinds: `mock` = 设计产出，`case` = 设计灵感. Default base URL `https://design.lobe.li`.
Media: images → WebP, video → WebM via CLI; CDN `https://design.lobeobjects.space`.

## 门禁 / Gates (mandatory before create /upload)

Agents **must** apply these gates before `create` / `upload` / curated `update`.
Do not invent HTTP against `/api/trpc` to bypass them. Detail + checklist:
[references/gates.md](references/gates.md). Schema: `packages/cli/src/utils/schema.ts`.

### Two kinds (browse UI)

| kind   | 中文         | Meaning                                       |
| ------ | ------------ | --------------------------------------------- |
| `mock` | **设计产出** | Our design work with STAR + tracing + rating  |
| `case` | **设计灵感** | Curated external / reusable design references |

Browse site shows **only** these two. `raw` / `rejected` stay off the UI.

### 设计灵感 (`case`) — what may enter curated

**Admit** (`tier: curated`, prefer `case_admit: design_ref`):

- Learnable product / UI references; landing / pricing finished comps
- Design-method covers / redline annotations; photo→finished design contrasts
- Magazine-style design cards (subject = the design)

Quality bar ≈ `#design` / `#case-room`, but **not channel-gated** — other channels OK if same quality.

**Reject** (`tier: rejected` — do **not** curated-upload):

- Requirement / complaint / naming-rant screenshots
- Engineering bug dumps; random `#dev` likes ≠ curated
- LobeHub own promo (brand bars, promo posters, launch cards)
- Agent image / motion workflow demos (chat + preview)
- Real-person street / event / community photos; photo-reference raws (subject = person)
- Isolated IP / mascot / blind-box stills; pure character marketing
- Booth / hardware snaps; unrelated social screenshots

**Fields:** bilingual `title` + `title_en` + tags (UI shows zh); title = object+pattern;
tags fine-grained **\~5–12** (object / component / interaction / platform / state / technique),
never a single coarse tag like `other`; write **`core`** (true subject, e.g. 本地脱敏) +
**`summary`** + emphasize **`why_good`**; `sources` include original URL (X / Discord).

### 设计产出 (`mock`) — gates

- Split by **case dimension** (each exploration / direction = own entry), **not** by Discord thread.
  Example: Agent 头像「脸型矩阵」vs「状态环」= two mocks.
- Title: object + change/mode; bilingual title/tags; fine tags 5–12.
- **Final assets:** all directions that are stage-OK (not only last few frames); weak process
  drafts → **tracing**, not final album. Cover 「n 图」= final album count.
- `status`: `shipped` | `iterating` | `rejected` | `superseded`.

### STAR writing (`mock.star`)

Concrete Chinese prose — not empty slogans:

- **situation**: context / constraints / who asked
- **task**: design goal / decision to make
- **action**: what was tried / chosen (tradeoffs)
- **result**: outcome / what shipped or stuck

### 好在哪 / 差在哪

- `problems[]` as `{ problem, solution? }` or strings for gaps/risks (差在哪)
- `rating_pros` / `rating_cons` + `rating_reason` for 好在哪 / 差在哪 tied to score
- STAR Result may state what worked; problems must not duplicate empty fluff

### Scoring (`rating` 0–5)

- Required on mocks when context exists — never leave blank if Discord human feedback + STAR/problems can support an inference
- UI shows **stars only** (no 「5/5」 text)
- Always fill brief `rating_reason`
- Rubric: **5** strong praise / clear win / few residual problems · **4** solid, minor nits ·
  **3** mixed / iterating with real gaps in problems · **1–2** weak / rejected path / major issues ·
  **0** unusable / wrongly filed

### Effective tracing

- Full related-people chat, not Helper-only; include Discord **and** Grok Bot design dialogue when relevant
- Avatars for user + agents; resolve `@` mentions to usernames (no bare ids)
- Images sized like Discord chat (not full-bleed); attach process drafts here
- No useless phase labels
- Prefer `discord.messages` / thread ids / urls (schema already supports)

### Pre-flight (block create/upload if any fail)

1. Kind correct (`mock` vs `case`)?
2. Case: admit → `tier: curated` + fields; else `rejected` + `reject_reason` (no curated upload)?
3. Mock: one case-dimension per entry; final vs tracing split correct?
4. Bilingual title + 5–12 fine tags?
5. Case: `core` / `summary` / `why_good` / source URL? Mock: STAR four fields concrete + problems + rating + `rating_reason`?
6. Tracing useful when claiming a design story?
7. Bins are `lobe-design` / `lhd` only?

## Rules of thumb

1. Use `lobe-design` instead of hand-rolled HTTP to `/api/trpc`.
2. Parse `--json` output; do not scrape TTY tables.
3. Mutate the archive only when the user asked; always pass `--yes` for deletes.
4. **Pass 门禁 / Gates above** (and [references/gates.md](references/gates.md)) before every create/upload.
5. After installing skills, tell the user to run lobe-design `05-init` / bootstrap if
   the host project has no `.agents/ux/product.md` yet.

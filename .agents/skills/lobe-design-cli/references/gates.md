# 门禁 / Archive admission gates

> Agents **must** apply these gates before `lobe-design create` / `upload` / `update` that admits an entry to the browseable archive.
> Schema source of truth: `packages/cli/src/utils/schema.ts`.
> CLI bins: **`lobe-design`** / **`lhd`** only — never `ld`.

## Two kinds (browse UI)

| kind   | 中文         | Meaning                                       |
| ------ | ------------ | --------------------------------------------- |
| `mock` | **设计产出** | Our design work — STAR + tracing + rating     |
| `case` | **设计灵感** | Curated external / reusable design references |

Browse site shows **only** these two. `tier=raw` / `tier=rejected` may stay on disk or in DB for ops, but **must not** surface in the UI.

Media pipeline: images → WebP, video → WebM via CLI; public CDN `https://design.lobeobjects.space`.

---

## 设计灵感 (`case`) — curated admission

Quality bar ≈ `#design` / `#case-room`, but **not channel-gated**: other channels (or X / web) are OK if the same quality.

### Admit (`tier: curated`, prefer `case_admit: design_ref`)

- Learnable product / UI references
- Landing / pricing **finished** comps
- Design-method covers / redline annotations
- Photo → finished design contrasts (Before/After design cards)
- Magazine-style design cards / illustration comps where the subject is the **design**

### Reject (`tier: rejected` — do **not** upload as curated)

- Requirement / complaint / naming-rant screenshots
- Engineering bug dumps; random `#dev` likes / reactions ≠ curated
- LobeHub **own** promo (brand bars, promo posters, launch cards, quota narrative collateral)
- Agent image / motion workflow demos (chat + preview loops)
- Real-person street / event / community group photos; photo-reference raws where the subject is the **person**, not the design
- Isolated IP / mascot / blind-box stills; pure character marketing assets
- Booth / hardware snaps; unrelated social screenshots

If borderline: prefer `rejected` with `reject_reason`, not silent curated.

### Required fields (case)

- **Bilingual** `title` + `title_en` (UI shows zh). Title = **object + pattern** clearly — no vague 「其他」, no English-only fragments, no bare component name.
- **Tags** bilingual, fine-grained **\~5–12** (object / component / interaction / platform / state / technique). Never a single coarse tag like `other`.
- Write **`core`** (true subject, e.g. 本地脱敏 /content security — not vague 「Design」), **`summary`**, and emphasize **`why_good`**.
- `tier: curated` **only** when admitted; set `case_admit: design_ref` when applicable.
- `sources` must include the original URL (X / Discord / site). Prefer also filling `discord` when harvested from Discord.

---

## 设计产出 (`mock`) — gates

### Split by case dimension — not by Discord thread

Each exploration / direction = **its own** entry. Example: Agent 头像「脸型矩阵」vs「状态环」= **two** mocks. Do not merge unrelated directions into one STAR card.

### Title / tags / status

- Title: **object + change/mode** (zh primary); bilingual `title` / `title_en` and tags.
- Tags fine-grained **5–12** (same rules as case).
- `status`: `shipped` | `iterating` | `rejected` | `superseded`.

### Final assets vs tracing

- **Final album** (`images[].role` ≈ `final` / `cover` / `album`): **all** directions that are stage-OK — not only the last few frames in a thread.
- Weak process drafts → **`tracing`** (or `iteration`), **not** the final album.
- Cover caption / 「n 图」= **final album count**, not total files including process drafts.

---

## STAR writing (`mock.star`)

Write **concrete Chinese prose** (not empty slogans):

| Field       | Write                                       |
| ----------- | ------------------------------------------- |
| `situation` | Context / constraints / who asked           |
| `task`      | Design goal / decision to make              |
| `action`    | What was tried / chosen (include tradeoffs) |
| `result`    | Outcome / what shipped or what stuck        |

Empty boilerplate (「沟通充分」「继续优化」) is a gate failure — rewrite with specifics.

---

## 好在哪 / 差在哪

- **`problems[]`**: gaps /risks (差在哪). Each item is a string **or** `{ "problem", "solution"? }`. Prefer problem+optional solution over fluff.
- **`rating_pros` / `rating_cons`** + **`rating_reason`**: 好在哪 / 差在哪 summary tied to the score.
- STAR `result` may state what worked; **`problems` must not duplicate empty praise**.

---

## Scoring (`rating` 0–5)

- Required on mocks when context exists — **never leave blank** if Discord human feedback and/or STAR/problems can support an inference.
- UI shows **stars only** (no 「5/5」 text beside them).
- Always fill a brief **`rating_reason`**.

| Score   | Guidance                                              |
| ------- | ----------------------------------------------------- |
| **5**   | Strong human praise, clear win, few residual problems |
| **4**   | Solid, minor nits                                     |
| **3**   | Mixed / iterating; real gaps listed in `problems`     |
| **1–2** | Weak / rejected path / major issues                   |
| **0**   | Unusable / wrongly filed                              |

Infer from Discord **human** feedback + STAR + problems — not from bot self-congratulation alone.

---

## Effective tracing

- Full **related-people** chat, not Helper-only.
- Include **Discord and** Grok Bot design dialogue when relevant.
- Avatars for user + agents; resolve `@` mentions to **usernames** (no bare ids).
- Images sized like Discord chat (not full-bleed); attach process drafts here.
- No useless phase labels.
- Prefer storing messages via schema fields already supported: `discord.messages`, `thread_ids`, `urls`, `message_ids`, `channel_or_thread_id`.

---

## Pre-flight checklist (agents)

Before `create` / `upload` / curated `update`:

1. Kind correct? (`mock` vs `case`)
2. If `case`: admit or reject? If reject → `tier: rejected` + `reject_reason`, do not curated-upload.
3. If `mock`: one case-dimension per entry? Final vs tracing split correct?
4. Bilingual title + 5–12 fine tags?
5. Case: `core` / `summary` / `why_good` / sources URL? Mock: STAR four fields concrete? `problems` + rating + `rating_reason`?
6. Tracing useful (people, resolved mentions, process drafts) when claiming a design story?
7. Media will go through CLI convert (WebP / WebM); bins are `lobe-design` / `lhd` only.

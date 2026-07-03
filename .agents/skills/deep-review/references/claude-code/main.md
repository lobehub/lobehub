# Deep Review · Claude Code Manual

Deep mode in Claude Code, end to end. "Subagent" below means a Task-tool agent: subagents share no context with the main agent, so every prompt must be self-contained (scope summary, changes or fetch commands, return format — all included).

Model tier: review and verify subagents run fine on a balanced/fast tier — quality comes from the dimension rules, not model brains. If the harness supports per-Task model selection, prefer the balanced tier (e.g. sonnet-class) over the largest model.

## Step 0 — Scope & background

Follow [`../scoping.md`](../scoping.md). Outputs: the `{changes}` payload (diff text or fetch commands), the ≤ 200-word scope summary, and PR metadata in PR mode.

## Step 1 — Select dimensions

1. Apply the pruning table in `SKILL.md` to the changed-file list; note each pruned dimension and its one-line reason (they go in the report header).
2. Detect extension packs: list sibling `deep-review-*` directories in the active skills root (e.g. `.agents/skills/deep-review-cloud/`). For each surviving dimension, collect its rule-file paths: built-in `references/dimensions/<name>.md` plus any extension counterpart; extension-only files add new dimensions (prune those with the same table logic, using their frontmatter `skip_when`).

## Step 2 — Spawn all reviewers in one wave

**Hard requirement: launch every selected dimension's review Task concurrently in a single response.** One dimension per Task keeps each reviewer's attention undivided; parallel latency ≈ the slowest single dimension.

Per Task:

1. Read [`../review-prompt.md`](../review-prompt.md) once; instantiate per dimension:
   - `{dimensions}` → the dimension id
   - `{dimension_files}` → that dimension's rule-file paths from step 1
   - `{scope_summary}` / `{changes}` → step 0 outputs
2. The substituted text is the Task's entire prompt.
3. `description`: `review: <dimension>`; `subagent_type`: `general-purpose`.

## Step 3 — Pipelined verification

Verification is per-dimension and starts the moment that dimension's reviewer returns — never wait for the other reviewers (no global barrier).

On each reviewer's return:

1. Extract the ` ```json ` fence, `JSON.parse` it. Parse failure or wrong schema → reject and re-spawn that reviewer with the same prompt (malformed JSON is itself a laziness signal).
2. Dimension marked `verify: false` (workflow, skill-freshness) → findings go straight to the report pool.
3. Zero findings → done with this dimension.
4. Otherwise spawn a verify Task immediately: read [`../verify-prompt.md`](../verify-prompt.md), substitute `{issues}` (this reviewer's findings array), `{scope_summary}`, `{changes}`; `description`: `verify: <dimension>`.

Anti-shortcut validation on each verify return:

- Extract + parse the JSON; `verifications.length` must equal the input count, ids matching one-to-one (Set difference finds gaps).
- Mismatch → spawn a fresh verify Task carrying only the missing ids' original findings and the full verify prompt (every Task is a new subagent; re-supply full context). Do not loosen the check.
- > 20 findings from one reviewer → split verification into 2 batches by id order (rare; default is one batch).

Verdict handling: `confirmed` → report pool (apply `fix_options_override` / `nature_override` / `same_root_as`); `false_positive` → drop; `need_more_context` → "Needs your input" appendix. Never let the main agent "fill in context" and re-verify by itself — that pollutes the main context and violates the independence principle; escalate through the appendix instead.

## Step 4 — Render the report

Render strictly per [`../report-template.md`](../report-template.md) — structure, ordering, P2 cap, unverified-dimension sections, statistics, and the PR-mode merge verdict (decision table lives in the template; the main agent fills it, never a subagent). Run the template's pre-send self-check before sending.

## Step 5 — Ask about the "safe to fix now" batch

When the batch is non-empty, use `AskUserQuestion` (don't just write "want me to fix these?" in prose):

- Question: `"Safe to fix now" has N low-risk findings — apply them all in one pass?`
- Options: `Fix all` (recommended; apply each finding's fix option) / `Not now` (report only). Partial picks arrive via the built-in "Other" answer.

`Fix all` → apply each fix, add regression tests where `need_test: true`, one line per fix in the reply. Empty batch → skip this step silently.

## Step 6 — Walk the remaining decisions

Confirmed findings with `can_auto_fix: false` plus the `need_more_context` appendix need user decisions. When non-empty, drive them through `AskUserQuestion`:

- ≤ 4 questions per call; order by P0 → P1 → P2, `blocks_release: true` first; tell the user when more remain for the next round.
- One finding = one question: confirmed items offer their `fix_options` as options (single option → `Apply the fix` / `Skip this round`); `need_more_context` items ask for the missing context (`I'll provide it` / `Park it`).
- Apply whatever the user picks (tests included where flagged); park the rest.

Both lists empty → the report ends the flow; ask nothing.

## Notes

- **Self-containment**: any information a subagent needs must be in its prompt — especially the scope summary and changes payload.
- **Small vs large diff**: ≤ 200 lines AND ≤ 5 files → inline diff text into prompts; larger → pass fetch commands (very-large check first — see scoping.md).
- **PR mode trigger**: GitHub PR URL in the user's message only.
- **Do not degrade**: if Tasks cannot be spawned in this environment, stop and tell the user to use light mode — a main-agent-only "deep review" violates the skill's core principles.

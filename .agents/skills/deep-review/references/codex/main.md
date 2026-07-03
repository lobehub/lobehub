# Deep Review · Codex Manual

Deep mode in Codex, end to end. "Subagent" below means a `spawn_agent` agent: subagents share no context with the main agent, so every prompt must be self-contained.

Codex constraints this manual is built around:

- **Concurrency budget**: multi\_agent\_v2 caps concurrent threads per session (default 4 including the root — 3 usable subagent slots); the legacy `agents.max_threads` default is 6. The flow therefore runs dimensions as **3 composite groups** in a single wave instead of one agent per dimension.
- **Slots are held until closed**: a finished agent still occupies its slot until `close_agent`. Close every agent as soon as you've consumed its result.
- **Delegation policy**: Codex spawns subagents only when the user explicitly allows agent delegation. Deep mode is explicitly invoked, which is that permission; if your session policy still forbids spawning, stop and offer light mode — never degrade to a single-agent "deep review".
- Model per agent: balanced tier is enough (rules carry the quality); use a faster/mini tier for the `process` group, which is scan-heavy.

## Group table

Dimension rules stay one-per-file; Codex only changes how they are **packed**:

| Group         | Dimensions (in prompt order)                         |
| ------------- | ---------------------------------------------------- |
| `quality`     | code-style, reuse-architecture, ux                   |
| `correctness` | business-logic, performance, security, compatibility |
| `process`     | workflow, skill-freshness, observability             |

Pruning removes dimensions from a group; a fully pruned group is not spawned. The table is a starting point — recalibrate the packing in this file if group runtimes drift far apart.

## Step 0 — Scope & background

Follow [`../scoping.md`](../scoping.md). Outputs: `{changes}` (diff text or fetch commands), the ≤ 200-word scope summary, PR metadata in PR mode.

## Step 1 — Select dimensions

Same as the pruning + extension-pack procedure in `SKILL.md`: apply the pruning table, detect sibling `deep-review-*` extension packs, collect each surviving dimension's rule-file paths (built-in + extension counterpart). Map surviving dimensions onto the group table.

## Step 2 — Spawn all groups in one wave

Launch every non-empty group's `spawn_agent` concurrently in a single turn (≤ 3 agents — fits the default slot budget).

Per group:

1. Read [`../review-prompt.md`](../review-prompt.md); instantiate:
   - `{dimensions}` → the group's surviving dimension ids (comma-separated)
   - `{dimension_files}` → all their rule-file paths
   - `{scope_summary}` / `{changes}` → step 0 outputs
2. Substituted text → `spawn_agent.message`. Prompts are self-contained; `fork_context` stays `false` unless the session holds hard-to-summarize requirement background.

## Step 3 — Collect, close, verify (pipelined)

Loop `wait` until all review agents have returned (wait is wait-any — call it repeatedly). For **each** returned review agent, immediately:

1. `close_agent` it — frees the slot for the verifier.
2. Extract the ` ```json ` fence and parse. Parse failure / wrong schema → reject, re-spawn that group with the same prompt.
3. Partition its findings by dimension `verify` flag: `verify: false` dimensions (workflow, skill-freshness) go straight to the report pool; zero verifiable findings → done with this group.
4. Otherwise spawn that group's verify agent now (do not wait for other groups): [`../verify-prompt.md`](../verify-prompt.md) with `{issues}` = this group's verifiable findings, plus `{scope_summary}` / `{changes}`.

On each verify return: `close_agent` first, then validate — `verifications.length` equals input count, ids one-to-one (Set difference). Mismatch → spawn a fresh verify agent with the missing ids' findings and the full prompt; do not loosen. Verdicts: `confirmed` → report pool (apply overrides / `same_root_as`); `false_positive` → drop; `need_more_context` → "Needs your input" appendix. The main agent never re-verifies findings itself.

Slot arithmetic: 3 review agents spawn together; each close frees a slot before its verifier spawns, so the flow never exceeds 3 concurrent agents and never deadlocks on the default budget.

## Step 4 — Render the report

Render strictly per [`../report-template.md`](../report-template.md) — structure, P2 cap, unverified-dimension sections, statistics, PR-mode merge verdict (main agent fills the decision table; never delegated). Run the template's pre-send self-check. Do not fall back to Codex's default findings format.

## Step 5 — Ask about the "safe to fix now" batch

Non-empty batch → one `request_user_input` (allowed regardless of delegation policy): `"Safe to fix now" has N low-risk findings — apply them all in one pass?` with options `Fix all` (recommended) / `Not now`; free-text covers partial picks. `Fix all` → apply each fix option, add regression tests where `need_test: true`, one line per fix. Empty → skip silently.

## Step 6 — Walk the remaining decisions

`can_auto_fix: false` confirmed findings + the `need_more_context` appendix, when non-empty, go through `request_user_input` one finding at a time — P0 → P1 → P2, `blocks_release: true` first; offer the finding's `fix_options` as the choices. Apply what the user picks; park the rest. Both lists empty → the report ends the flow.

## Notes

- **Self-containment**: everything a subagent needs lives in its prompt — especially scope summary and changes payload.
- **Small vs large diff**: ≤ 200 lines / ≤ 5 files → inline the diff; larger → pass fetch commands.
- **PR mode trigger**: GitHub PR URL in the user's message only.
- Raising `agents.max_threads` shortens nothing here (the wave already fits 3 slots) — keep the group table as the execution grain for predictability.

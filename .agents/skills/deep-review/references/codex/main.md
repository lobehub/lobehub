# Deep Review · Codex Manual

Deep mode in Codex, end to end. "Subagent" below means a `spawn_agent` agent. Every prompt is written to be self-contained, which is correct under any Codex version.

The multi-agent API differs across Codex versions — tool names, parameters, and defaults all move. **Everything in this section is a claim to verify against the session you are actually in, not a fact to rely on.** Read the discovered tools' real schemas before step 2 and bind the manual's verbs and parameters to what exists.

- **Tool discovery first**: names vary — e.g. surfaced via `tool_search` as `multi_agent_v1.spawn_agent` / `wait_agent` / `close_agent`, or exposed directly as `spawn_agent` / `wait` / `close_agent`. Search/list the session's tools and bind the spawn/wait/close verbs used below to the names actually exposed; do not assume this manual's names exist verbatim. If no multi-agent tools can be surfaced, stop and offer light mode.
- **Context inheritance is the one default you must not guess.** Independent reviewers are the whole point of deep mode — a subagent that inherits the main agent's context has already seen your reasoning and will confirm it rather than review it. That failure is silent: the flow completes, the report looks normal, the independence is gone. So read the spawn tool's schema for whatever controls inheritance (`fork_turns`, `fork_context`, or a version-specific equivalent) and set it explicitly to **no inheritance** — never rely on the default being off. If the tool exposes no such control and inheritance cannot be turned off, say so in the report: the verify pass is then not adversarial and its `confirmed` verdicts are weaker than they look.
- **Concurrency budget**: multi\_agent\_v2 caps concurrent threads per session (default 4 including the root — 3 usable subagent slots); the legacy `agents.max_threads` default is 6. The flow therefore runs dimensions as **3 composite groups** in a single wave instead of one agent per dimension.
- **Slot lifecycle**: where a close verb exists, a finished agent still occupies its slot until it is closed — close every agent as soon as you've consumed its result, which is what makes step 3's pipelining work. If the session exposes no close verb, slots free on their own terms: drop the recycling assumption and run review-wave → verify-wave as two plain waves instead of pipelining. Coverage is the contract; pipelining is only an optimization.
- **Delegation policy**: Codex spawns subagents only when the user explicitly allows agent delegation. Deep mode is explicitly invoked, which is that permission; if your session policy still forbids spawning, stop and offer light mode — never degrade to a single-agent "deep review".
- Model per agent: balanced tier is enough (rules carry the quality); use a faster/mini tier for the `process` group, which is scan-heavy.

## Group table

Dimension rules stay one-per-file; Codex only changes how they are **packed**:

| Group         | Dimensions (in prompt order)                              |
| ------------- | --------------------------------------------------------- |
| `quality`     | code-style, reuse-architecture, business-logic, ux        |
| `correctness` | logic, performance, security, compatibility, release-risk |
| `process`     | workflow, skill-freshness, observability                  |

Pruning removes dimensions from a group; a fully pruned group is not spawned. The table is a starting point — recalibrate the packing in this file if group runtimes drift far apart. `release-risk` sits with `performance` on purpose: both read the migration files, from opposite angles (cost vs reversibility), so one agent reads them once. Keep the angle separation their dimension files define — one shared agent must still emit two distinct findings, never a merged one.

Extension packs can also **add** dimensions (a `deep-review-*/dimensions/` file whose name matches no built-in). Added dimensions have no row in the table: collect them into a dynamic fourth group, `extras`. `extras` never joins the initial wave — it queues until the first `close_agent` frees a slot (a slot is only free in the initial wave when a built-in group was fully pruned). Their verify routing follows each dimension file's own `verify` frontmatter flag (default: verified).

## Step 0 — Scope & background

Follow [`../scoping.md`](../scoping.md). Outputs: `{changes}` (diff text or fetch commands), the ≤ 200-word scope summary, PR metadata in PR mode.

## Step 1 — Select dimensions

Same as the pruning + extension-pack procedure in `SKILL.md`: apply the pruning table, detect sibling `deep-review-*` extension packs, collect each surviving dimension's rule-file paths (built-in + extension counterpart). Map surviving dimensions onto the group table; extension-added dimensions go to the `extras` group (see above) so downstream rules never get silently dropped.

## Step 2 — Spawn all groups in one wave

Launch the three built-in groups' `spawn_agent` concurrently in a single turn (≤ 3 agents — fits the default slot budget). A non-empty `extras` group is NOT part of this wave: queue it — step 3's dispatch priority gives it the first freed slot (step 3 closes each review agent as soon as its result is consumed, so the wait is short).

Per group:

1. Read [`../review-prompt.md`](../review-prompt.md); instantiate:
   - `{dimensions}` → the group's surviving dimension ids (comma-separated)
   - `{dimension_files}` → all their rule-file paths
   - `{scope_summary}` / `{changes}` → step 0 outputs
2. Substituted text → `spawn_agent.message`. Prompts are self-contained, so set the inheritance control discovered above to **no inheritance** — this is the step where reviewer independence is won or silently lost.

## Step 3 — Collect, close, verify (pipelined)

Loop `wait` until all review agents have returned — the initial wave plus a late-spawned `extras` (wait is wait-any — call it repeatedly). For **each** returned review agent, immediately:

1. `close_agent` it — frees a slot. **Dispatch priority for the freed slot**: a still-queued `extras` group spawns first and joins the review wait set; only then does the slot go to a verifier.
2. Extract the ` ```json ` fence and parse. Parse failure / wrong schema → reject, re-spawn that group with the same prompt.
3. Partition its findings by dimension `verify` flag: `verify: false` dimensions (workflow, skill-freshness) go straight to the report pool; zero verifiable findings → done with this group. A returned `release_checks` array (release-risk only) also bypasses verification — never include it in `{issues}`; it holds questions about production state, not claims to falsify.
4. Otherwise spawn that group's verify agent in the next slot the dispatch priority allows (do not wait for other groups): [`../verify-prompt.md`](../verify-prompt.md) with `{issues}` = this group's verifiable findings, plus `{scope_summary}` / `{changes}`.

On each verify return: `close_agent` first, then validate — `verifications.length` equals input count, ids one-to-one (Set difference). Mismatch → spawn a fresh verify agent with the missing ids' findings and the full prompt; do not loosen. Verdicts: `confirmed` → report pool (apply overrides / `same_root_as`); `false_positive` → drop; `need_more_context` → "Needs your input" appendix. The main agent never re-verifies findings itself.

Slot arithmetic: up to 3 review agents spawn together; every later spawn (queued `extras`, verifiers) fills a slot freed by `close_agent`, so the flow never exceeds 3 concurrent agents and never deadlocks on the default budget. When `extras` claims the first freed slot it delays that one verifier by a single turn — acceptable, review coverage is the contract.

## Step 4 — Render the report

Render strictly per [`../report-template.md`](../report-template.md) — structure, P2 cap, unverified-dimension sections, statistics, PR-mode merge verdict (main agent fills the decision table; never delegated). Run the template's pre-send self-check. Do not fall back to Codex's default findings format.

## Step 5 — Ask about the "safe to fix now" batch

Non-empty batch → one `request_user_input` (allowed regardless of delegation policy): `"Safe to fix now" has N low-risk findings — apply them all in one pass?` with options `Fix all` (recommended) / `Not now`; free-text covers partial picks. `Fix all` → apply each fix option, add regression tests where `need_test: true`, one line per fix. Empty → skip silently.

## Step 6 — Walk the remaining decisions

`can_auto_fix: false` confirmed findings + the `need_more_context` appendix, when non-empty, go through `request_user_input` one finding at a time — P0 → P1 → P2, `blocks_release: true` first; offer the finding's `fix_options` as the choices. Apply what the user picks; park the rest. Both lists empty → skip silently and go to Step 7.

**Only in-scope findings enter this loop.** Everything under `Hand off to owner` is excluded — never offer to fix a pre-existing problem here. Low-likelihood non-blocking findings go last, and are skipped entirely on a repeat review unless the user asks.

## Step 7 — Offer to file the hand-off issues

Runs whether or not Step 6 asked anything — only condition is that `Hand off to owner` is non-empty. One `request_user_input`: `N pre-existing problems belong to other owners — create Linear issues for them?` with options `Create all` / `Pick some` / `Not now`. Create nothing before the user answers. On approval, follow the `linear` skill: Chinese content, one issue per finding, description carrying location + culprit commit/author/date + scenario + likelihood + verification evidence, assigned to the culprit author when identified. Report the created issue keys.

## Notes

- **Self-containment**: everything a subagent needs lives in its prompt — especially scope summary and changes payload.
- **Small vs large diff**: ≤ 200 lines AND ≤ 5 files → inline the diff; larger → pass fetch commands (very-large check first — see scoping.md).
- **PR mode trigger**: GitHub PR URL in the user's message only.
- Raising `agents.max_threads` shortens nothing here (the wave already fits 3 slots) — keep the group table as the execution grain for predictability.

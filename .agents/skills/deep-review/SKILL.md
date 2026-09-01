---
name: deep-review
description: 'Multi-dimensional code review. Use when the user asks to review, evaluate, or audit a PR, diff, branch, or pasted change — including informal review asks like "look at this change for problems" — via light mode: one independent reviewer against the dimension quick checklists. Not for explain-only questions about what a change does or why. Deep mode runs only on explicit invocation (/deep-review), and normally at most once per logical requirement.'
---

# Deep Review

Multi-dimensional code review built on independent reviewers. Review breadth comes from parallel
dimension coverage; precision comes from adversarial verification and global duplicate
consolidation before findings reach the report.

## Core principles

Every design choice below serves one of these. When unsure how to execute a step, come back here.

1. **Anti-hallucination** — reviewers that only see diff fragments invent bugs. Candidate findings are therefore falsified one by one by an **independent verify subagent** that reads full context and returns a three-way verdict (`confirmed` / `false_positive` / `need_more_context`). Three-way verdicts beat confidence percentages: calibrated-sounding scores are unreliable as hard filters.
2. **Anti self-approval** — an agent that just wrote the code is grading its own homework and will pass it. Both modes use an **independent reviewer** with a third-party stance. Light: one reviewer that is not the main agent. Deep: independent subagents per the environment manual. Never silently degrade either mode to "the main agent reviews the diff itself".
3. **Rules over model** — review quality comes from fine-grained, executable dimension rules, not from a smarter model. Subagents run on balanced/fast model tiers; each dimension file tells them exactly how to check, what counts, and what does not.
4. **Calibrate to codebase and lifespan** — hold the diff to the standard the codebase already meets, not an idealized one. If a pattern is widespread in the existing code and this diff does not make it worse, it is not a finding. Declared-temporary code (time-boxed campaign, experiment, one-off script) is judged against its lifespan: hardcoding and low-extensibility shortcuts are the intended trade-off for shipping fast, and "delete the code at expiry" is a valid plan — do not demand configurability from code built to be deleted. (Security is exempt from all calibration — see the dimension file.)
5. **Speed is a feature** — one wave of parallel reviewers, verification pipelined per dimension (never a global barrier), irrelevant dimensions pruned up front.

## Two entry modes

| Mode                | Trigger                                                                                                                                                             | What runs                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Light** (default) | Any ordinary review ask: "review this PR", an informal "look at this change for problems", a diff pasted for review — but not explain-only questions about a change | One independent reviewer against the **Quick checklist** of each applicable dimension. Prefer a different-vendor harness when the session can dispatch to one; otherwise one same-harness subagent. No verify pass. The main agent does not review. |
| **Deep**            | Explicit only: `/deep-review`, "run deep review", "full multi-agent review"                                                                                         | Full orchestration: dimension review agents → pipelined verification → global consolidation → structured report → interactive fix flow.                                                                                                             |

Do not auto-escalate light to deep. Do not run deep mode for a casual "看看这个改动" — that is light mode.

### Deep-mode budget

Within one logical requirement (the same requirement, PR, or branch), run Deep mode at most once by
default. Follow-up reviews after fixes, CI work, rebases, cleanup, context compaction, or a resumed
session use Light mode, even when they review the whole diff again. These events do not reset the
budget, and the review/verify/consolidate waves inside one Deep run all count as that single run.

Run Deep again only when the user explicitly requests another Deep pass, or when a genuinely new
logical requirement begins. A casual follow-up such as "review again", "复核一下", or "再看看" is a
Light request, not implicit authorization for another Deep run.

## Dimensions

Rules live in one place: [`references/dimensions/`](references/dimensions/), one file per dimension.
Both modes use the same files. The light reviewer reads the full `Quick checklist` section,
including nested example subsections; deep-mode agents read the full dimension file plus only the
rule sources and routed references applicable to the touched surface.

| Dimension                                                             | id prefix | Covers                                                                                                                                                                                                                                                                                    | Verified?            |
| --------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [ai-coding-bad-habits](references/dimensions/ai-coding-bad-habits.md) | `ai`      | narrow special cases in generic code, partial refactors, redundant type guards/aliases, comment narration, and precedent-blind implementation                                                                                                                                             | yes                  |
| [code-style](references/dimensions/code-style.md)                     | `style`   | naming, readability, dead code, comments, i18n hardcoding, UI-library and styling conventions                                                                                                                                                                                             | yes                  |
| [logic](references/dimensions/logic.md)                               | `logic`   | logic correctness: edge cases, null, races, error handling, state machines, requirement deviation, test coverage                                                                                                                                                                          | yes                  |
| [business-logic](references/dimensions/business-logic.md)             | `design`  | design judgment: framework misuse, best-practice violations, solution-weight mismatch, self-inflicted complexity                                                                                                                                                                          | yes                  |
| [new-feature](references/dimensions/new-feature.md)                   | `feature` | new-capability design: domain vocabulary and structure, durable data model and migration evidence, product analytics and operational observability                                                                                                                                        | yes                  |
| [reuse-architecture](references/dimensions/reuse-architecture.md)     | `reuse`   | duplicate implementations, unused existing patterns, extensibility, architectural boundaries                                                                                                                                                                                              | yes                  |
| [performance](references/dimensions/performance.md)                   | `perf`    | N+1, blocking calls, resource leaks, render-path waste, **DB migration locking and idempotency**                                                                                                                                                                                          | yes                  |
| [release-risk](references/dimensions/release-risk.md)                 | `risk`    | ship/no-ship gate: irreversible persisted state (incl. schemaless shape drift), dev-cycle migration residue, in-flight work & config at deploy time, irreversible outbound effects, prompt/tool-description behavior shifts, shared-surface and high-frequency-UI blast radius, PR purity | yes + checks         |
| [security](references/dimensions/security.md)                         | `sec`     | injection, auth bypass, secret/PII leakage, business-slot confidentiality                                                                                                                                                                                                                 | yes                  |
| [compatibility](references/dimensions/compatibility.md)               | `compat`  | light/dark theme, desktop app / web (desktop, mobile) / RN, released-client API compatibility, client vs server agent runtime (gateway on/off), Vercel vs Docker deploys, paired router configs                                                                                           | yes                  |
| [ux](references/dimensions/ux.md)                                     | `ux`      | empty/loading/error states, async feedback, confirmation flows, design-value adherence                                                                                                                                                                                                    | yes                  |
| [observability](references/dimensions/observability.md)               | `obs`     | debug: unexplained fixes, uncommented hacks, silent catches, missing logs; product: analytics on qualifying new capabilities; perf: monitoring on high-frequency / high-traffic / polling paths                                                                                           | yes                  |
| [workflow](references/dimensions/workflow.md)                         | `flow`    | issue tracking state, PR description freshness, undocumented key decisions, CI / preview build status                                                                                                                                                                                     | no (objective state) |
| [skill-freshness](references/dimensions/skill-freshness.md)           | `skill`   | agent skills invalidated by this diff, knowledge worth distilling into a new skill                                                                                                                                                                                                        | no (advisory)        |

`Verified? no` means findings from that dimension are objective state checks or advisories — they skip the verify pass and go straight to the report. `yes + checks` means the dimension's findings are verified normally, but it also emits a second, unverified output — `release_checks`, pre-deploy confirmation items about production state the repo cannot answer (see its dimension file).

### Pruning table (deep mode)

Before spawning, the main agent prunes dimensions that cannot apply to the diff. List pruned dimensions and the one-line reason in the report header. When in doubt, run the dimension.

| Dimension                                                                   | Skip when                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ai-coding-bad-habits, code-style, logic, business-logic, reuse-architecture | never (skip only for docs/lockfile-only diffs)                                                                                                                                                                                                         |
| new-feature                                                                 | diff does not introduce a new product, operator, or platform capability                                                                                                                                                                                |
| performance                                                                 | no server/db/loop/render-path code touched (e.g. docs, copy, pure type changes)                                                                                                                                                                        |
| release-risk                                                                | no DB schema/migration, no schemaless persisted payload, no queue/cron/config/outbound dependency, no prompt or tool-description text, no shared component or package public API, no high-frequency user surface, and the diff has one obvious purpose |
| security                                                                    | lockfile/generated-only diff — docs and copy still run it (text is a leak vector: secrets, internal URLs, commercial details)                                                                                                                          |
| compatibility                                                               | diff touches no UI theming/routing, no API contract, no deployment config, no runtime-branching code                                                                                                                                                   |
| ux                                                                          | no user-facing surface changed (components, styles, copy, interaction flows)                                                                                                                                                                           |
| observability                                                               | no error handling, async flow, server code, new user-facing capability, or perf-sensitive path touched                                                                                                                                                 |
| workflow                                                                    | light: no PR/issue/CI context is available; deep: never (cheap external-state checks)                                                                                                                                                                  |
| skill-freshness                                                             | light: the diff neither changes agent instructions nor changes behavior/conventions covered by an existing skill; deep: never (cheap)                                                                                                                  |

**"Docs-only" means human-facing prose only.** Files that are executable instructions for agents — `.agents/skills/**`, `AGENTS.md` / `CLAUDE.md`, prompt templates, orchestration manuals — count as code for pruning purposes: their "prose" carries control flow, contracts, and rules whose contradictions are exactly what logic / business-logic / reuse-architecture exist to catch. A diff touching them is never docs-only.

Light mode applies the same table to decide which Quick checklists to pass to the reviewer.

## Extension packs

A wrapping repository (e.g. a private deployment that vendors this repo as a submodule) can extend the rule set without forking this skill: any sibling skill directory in the active skills root matching `deep-review-*` (for example `.agents/skills/deep-review-cloud/`) is an extension pack.

- Extension packs contain `dimensions/*.md` files in the same format; a file named after a built-in dimension **extends** it (load both), a new name **adds** a dimension.
- An extension file declaring `extends: <name>` where no such built-in dimension exists (typically because the wrapping repo pins an older submodule commit) falls back to standing on its own. Such a file must therefore carry its own `id_prefix` / `verify` / `skip_when` so it stays usable either way; when the built-in is present, the built-in's frontmatter wins.
- Both modes must check for extension packs at startup and load whatever is present. Absence is normal — this skill is self-sufficient.
- Extension packs may carry rules that must not live in this open-source repo; never copy their content into files under this directory.

## Light mode procedure

If your user message is already an instantiated light-review prompt, you are the reviewer — follow
that prompt and do not re-enter this procedure.

1. Determine review scope exactly as deep mode step 0 does (see the environment manual's scope rules — three-dot diff from a base that does not lag the fork point, submodule diffs included), but skip the background-hunting extras when context already tells you what changed.
2. Apply the pruning table; collect the surviving dimension files plus extension-pack counterparts. Do not read the checklists yourself.
3. Instantiate [`references/light-review-prompt.md`](references/light-review-prompt.md) with the surviving `{dimensions}`, `{dimension_files}`, `{scope_summary}`, and `{changes}`. Dispatch exactly one independent reviewer, trying in this order:
   1. If this session can dispatch a self-contained task to a different vendor's coding-agent harness (not a same-harness subagent), use that. Prefer a preset whose job is independent code review when the dispatcher exposes one.
   2. Otherwise spawn one same-harness subagent. Disable context inheritance when the spawn API allows it.
   3. If the chosen path fails, try the next. If none work, stop and tell the user why. Do not review the diff yourself.
4. Relay the reviewer's findings in your environment's normal review format (light mode does NOT use the deep report template). Do not drop, downgrade, or re-verify findings. When the reviewer listed pre-deploy confirmation items, keep them as a short checklist separate from defects. Mention that deep mode exists if findings suggest the diff deserves a full pass.
   - On a follow-up round (verifying that earlier findings were fixed), dispatch again on the newly changed code as a fresh diff — never just confirm the requested edits landed. Fix commits introduce new logic (guards, parsers, refactors) whose bugs a checkbox pass will miss.

## Deep mode procedure

Before entering this procedure, check the logical requirement's Deep-mode budget above. If Deep has
already run and the user did not explicitly request another Deep pass, use the Light procedure.

Pick the manual for the current environment and follow it end to end:

- **Claude Code** → [`references/claude-code/main.md`](references/claude-code/main.md)
- **Codex** → [`references/codex/main.md`](references/codex/main.md)

If the environment is not listed, tell the user deep mode does not support it yet and offer light mode instead. Do not improvise another environment's mechanics, and do not simulate deep in the main agent or as one packed reviewer (see principle 2).

## Keeping this skill sharp

The `skill-freshness` dimension and the `workflow_feedback` channel in the subagent return schema exist to feed observations back into these files. When a review surfaces a rule gap, an outdated rule, or a recurring team preference, update the relevant dimension file in the same PR or a follow-up — that is how calibration stays current.

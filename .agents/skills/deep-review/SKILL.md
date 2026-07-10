---
name: deep-review
description: 'Multi-dimensional code review. Use when the user asks to review, evaluate, or audit a PR, diff, branch, or pasted change — including informal review asks like "look at this change for problems" — via light mode: inline review against the dimension quick checklists. Not for explain-only questions about what a change does or why. Deep mode runs only on explicit invocation (/deep-review): one review subagent per dimension plus independent verification subagents that falsify findings before reporting.'
---

# Deep Review

Multi-dimensional code review built on independent subagents. Review breadth comes from parallel per-dimension reviewers; precision comes from an adversarial verification pass that falsifies findings before they reach the report.

## Core principles

Every design choice below serves one of these. When unsure how to execute a step, come back here.

1. **Anti-hallucination** — reviewers that only see diff fragments invent bugs. Candidate findings are therefore falsified one by one by an **independent verify subagent** that reads full context and returns a three-way verdict (`confirmed` / `false_positive` / `need_more_context`). Three-way verdicts beat confidence percentages: calibrated-sounding scores are unreliable as hard filters.
2. **Anti self-approval** — an agent that just wrote the code is grading its own homework and will pass it. Review must run in **independent subagents** with a third-party reviewer stance. Never silently degrade deep mode to "the main agent reviews and then verifies its own findings".
3. **Rules over model** — review quality comes from fine-grained, executable dimension rules, not from a smarter model. Subagents run on balanced/fast model tiers; each dimension file tells them exactly how to check, what counts, and what does not.
4. **Calibrate to codebase and lifespan** — hold the diff to the standard the codebase already meets, not an idealized one. If a pattern is widespread in the existing code and this diff does not make it worse, it is not a finding. Declared-temporary code (time-boxed campaign, experiment, one-off script) is judged against its lifespan: hardcoding and low-extensibility shortcuts are the intended trade-off for shipping fast, and "delete the code at expiry" is a valid plan — do not demand configurability from code built to be deleted. (Security is exempt from all calibration — see the dimension file.)
5. **Speed is a feature** — one wave of parallel reviewers, verification pipelined per dimension (never a global barrier), irrelevant dimensions pruned up front.

## Two entry modes

| Mode                | Trigger                                                                                                                                                             | What runs                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Light** (default) | Any ordinary review ask: "review this PR", an informal "look at this change for problems", a diff pasted for review — but not explain-only questions about a change | Main agent reviews inline against the **Quick checklist** section of each applicable dimension file. No subagents.          |
| **Deep**            | Explicit only: `/deep-review`, "run deep review", "full multi-agent review"                                                                                         | Full orchestration: per-dimension review subagents → pipelined verify subagents → structured report → interactive fix flow. |

Do not auto-escalate light to deep. Do not run deep mode for a casual "看看这个改动" — that is light mode.

## Dimensions

Rules live in one place: [`references/dimensions/`](references/dimensions/), one file per dimension. Both modes read the same files (light mode reads only the `Quick checklist` section; deep-mode subagents read the full file plus its listed rule sources).

| Dimension                                                         | id prefix | Covers                                                                                                                                                                                          | Verified?            |
| ----------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [code-style](references/dimensions/code-style.md)                 | `style`   | naming, readability, dead code, comments, i18n hardcoding, UI-library and styling conventions                                                                                                   | yes                  |
| [logic](references/dimensions/logic.md)                           | `logic`   | logic correctness: edge cases, null, races, error handling, state machines, requirement deviation, test coverage                                                                                | yes                  |
| [business-logic](references/dimensions/business-logic.md)         | `design`  | design judgment: framework misuse, best-practice violations, solution-weight mismatch, self-inflicted complexity                                                                                | yes                  |
| [reuse-architecture](references/dimensions/reuse-architecture.md) | `reuse`   | duplicate implementations, unused existing patterns, extensibility, architectural boundaries                                                                                                    | yes                  |
| [performance](references/dimensions/performance.md)               | `perf`    | N+1, blocking calls, resource leaks, render-path waste, **DB migration locking and idempotency**                                                                                                | yes                  |
| [security](references/dimensions/security.md)                     | `sec`     | injection, auth bypass, secret/PII leakage, business-slot confidentiality                                                                                                                       | yes                  |
| [compatibility](references/dimensions/compatibility.md)           | `compat`  | light/dark theme, desktop app / web (desktop, mobile) / RN, released-client API compatibility, client vs server agent runtime (gateway on/off), Vercel vs Docker deploys, paired router configs | yes                  |
| [ux](references/dimensions/ux.md)                                 | `ux`      | empty/loading/error states, async feedback, confirmation flows, design-value adherence                                                                                                          | yes                  |
| [observability](references/dimensions/observability.md)           | `obs`     | bug fixes without explanatory comments/issue links, uncommented hacks, silent catches, missing logs on key paths                                                                                | yes                  |
| [workflow](references/dimensions/workflow.md)                     | `flow`    | issue tracking state, PR description freshness, undocumented key decisions, CI / preview build status                                                                                           | no (objective state) |
| [skill-freshness](references/dimensions/skill-freshness.md)       | `skill`   | agent skills invalidated by this diff, knowledge worth distilling into a new skill                                                                                                              | no (advisory)        |

`Verified? no` means findings from that dimension are objective state checks or advisories — they skip the verify pass and go straight to the report.

### Pruning table (deep mode)

Before spawning, the main agent prunes dimensions that cannot apply to the diff. List pruned dimensions and the one-line reason in the report header. When in doubt, run the dimension.

| Dimension                                             | Skip when                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| code-style, logic, business-logic, reuse-architecture | never (skip only for docs/lockfile-only diffs)                                                                                |
| performance                                           | no server/db/loop/render-path code touched (e.g. docs, copy, pure type changes)                                               |
| security                                              | lockfile/generated-only diff — docs and copy still run it (text is a leak vector: secrets, internal URLs, commercial details) |
| compatibility                                         | diff touches no UI theming/routing, no API contract, no deployment config, no runtime-branching code                          |
| ux                                                    | no user-facing surface changed (components, styles, copy, interaction flows)                                                  |
| observability                                         | no error handling, async flow, or server code touched                                                                         |
| workflow                                              | never in deep mode (cheap external-state checks)                                                                              |
| skill-freshness                                       | never in deep mode (cheap)                                                                                                    |

**"Docs-only" means human-facing prose only.** Files that are executable instructions for agents — `.agents/skills/**`, `AGENTS.md` / `CLAUDE.md`, prompt templates, orchestration manuals — count as code for pruning purposes: their "prose" carries control flow, contracts, and rules whose contradictions are exactly what logic / business-logic / reuse-architecture exist to catch. A diff touching them is never docs-only.

Light mode applies the same table to decide which Quick checklists to read.

## Extension packs

A wrapping repository (e.g. a private deployment that vendors this repo as a submodule) can extend the rule set without forking this skill: any sibling skill directory in the active skills root matching `deep-review-*` (for example `.agents/skills/deep-review-cloud/`) is an extension pack.

- Extension packs contain `dimensions/*.md` files in the same format; a file named after a built-in dimension **extends** it (load both), a new name **adds** a dimension.
- Both modes must check for extension packs at startup and load whatever is present. Absence is normal — this skill is self-sufficient.
- Extension packs may carry rules that must not live in this open-source repo; never copy their content into files under this directory.

## Light mode procedure

1. Determine review scope exactly as deep mode step 0 does (see the environment manual's scope rules — local default ref, three-dot diff, submodule diffs included), but skip the background-hunting extras when context already tells you what changed.
2. Apply the pruning table; read the `Quick checklist` section of each surviving dimension file, plus extension-pack counterparts.
3. Review inline. Findings must cite a rule source or code evidence; respect the codebase-calibration principle.
4. Output in your environment's normal review format (light mode does NOT use the deep report template). Mention that deep mode exists if findings suggest the diff deserves a full pass.

## Deep mode procedure

Pick the manual for the current environment and follow it end to end:

- **Claude Code** → [`references/claude-code/main.md`](references/claude-code/main.md)
- **Codex** → [`references/codex/main.md`](references/codex/main.md)

If the environment is not listed, tell the user deep mode does not support it yet and offer light mode instead. Do not improvise another environment's mechanics, and do not degrade to a single-agent pass (see principle 2).

## Keeping this skill sharp

The `skill-freshness` dimension and the `workflow_feedback` channel in the subagent return schema exist to feed observations back into these files. When a review surfaces a rule gap, an outdated rule, or a recurring team preference, update the relevant dimension file in the same PR or a follow-up — that is how calibration stays current.

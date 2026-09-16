---
name: write-landing-docs
description: 'Use for authoring or revising public LobeHub website documentation under docs/**, including self-hosting, deployment, migration, and configuration guides. Excludes product changelogs and source-code API docs.'
---

# Write Landing Documentation

The public documentation rendered on the LobeHub website is authored in this repository under
`docs/**`. Write for the reader's task, not for the implementation that happens to provide it.

## Scope

- Use this skill for public guides, concepts, configuration, deployment, troubleshooting, and
  migration pages under `docs/**`.
- For product changelogs under `docs/changelog/**`, use `../docs-changelog/SKILL.md` instead.
- Keep source-code API documentation, internal runbooks, and contributor-only instructions with the
  code or repository that owns them.
- A documentation task does not authorize unrelated product or deployment changes. Change the
  landing application only when the requested documentation change also requires a public URL
  redirect or another clearly scoped integration.

## Required Context

- Read the `Voice & Content` section of `../../../DESIGN.md` before drafting user-facing prose.
- For any page under `docs/self-hosting/**`, read
  [the self-hosting reference](references/self-hosting.md) before deciding the audience, page
  structure, recommendation, or level of detail.
- Inspect neighboring pages and the code, configuration, or commands that establish the facts. Do
  not infer current behavior from an old guide alone.

## Authoring Workflow

1. **Define the reader and task.** State who the page is for, what condition brought them there, and
   what observable outcome completes the task.
2. **Verify the facts.** Confirm supported options, defaults, prerequisites, commands, environment
   variables, limitations, and rollback behavior from the current implementation.
3. **Choose one canonical page.** Keep variants on one page when they solve the same task and differ
   only in a few commands or settings. Split pages when audiences, prerequisites, or operating
   lifecycles are materially different.
4. **Lead with the decision.** Tell the reader whether the page applies to them and recommend the
   normal path before presenting advanced alternatives.
5. **Write the executable path.** Prefer a short numbered sequence with exact names and commands.
   Put optional explanation after the action it clarifies.
6. **Prove completion.** Include a user-visible verification step. Add rollback or recovery when a
   failed step could leave data, configuration, or availability in an uncertain state.
7. **Keep language pairs aligned.** When English and Simplified Chinese pages are maintained as a
   pair, keep their facts, decision order, warnings, links, and commands equivalent while translating
   naturally.

## Writing Contract

- Use plain language, short sentences, and consistent product terms.
- Make prerequisites and branch conditions explicit. Do not make the reader infer them from prose.
- Prefer a recommended default plus clearly labeled alternatives over an unranked option catalog.
- Keep implementation detail only when it changes a decision, command, safety boundary, failure
  mode, or verification result. Link to a focused advanced guide or source code for deeper internals.
- Use exact environment-variable names, configuration values, UI labels, paths, and commands.
- Do not promise support, compatibility, performance, deadlines, or data safety without current
  evidence.
- Do not use marketing language to hide trade-offs. State limitations next to the affected option.

## Public URL Changes

When renaming or moving a published page:

1. Update all in-repository links to the canonical path.
2. Search for external entry points that still use the old path.
3. Add a permanent redirect in the landing repository using its current routing architecture.
4. Preserve locale prefixes and query parameters unless the product intentionally changes them.
5. Add a focused regression test and make a real local request to verify the status and `Location`
   header.

Do not keep two independently maintained copies of the same guide merely to preserve an old URL.

## Validation

- Run the repository's focused documentation check on every changed page.
- Check frontmatter, headings, code fences, relative links, anchors, and EN/ZH parity.
- Re-read the numbered path as a new user: every step must have enough information to execute and a
  visible success condition.
- Documentation-only changes do not require product acceptance, but executable commands and URL
  redirects still require proportionate verification.

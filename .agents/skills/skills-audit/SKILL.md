---
name: skills-audit
description: 'Audit .agents/skills SKILL.md files. Use for recurring checks of duplicate, overlapping, stale, inconsistent, or broken skills and merge/delete candidates.'
argument-hint: '[--verbose | --apply]'
---

# Skills Audit

Periodic review of the project-local skill set under `.agents/skills/`. The goal is to catch drift before the catalog becomes confusing — too many skills, overlapping triggers, descriptions that no longer match the body, references to skills that were renamed/deleted.

**Recommended cadence:** weekly, or after any week where >1 skill was added/renamed.

## Procedure

### 1 — Inventory

Build a current inventory, including symlinked skills. Look for inventory/check helpers in `package.json` scripts and `.agents/scripts/`; reuse them when available and inspect their supported options rather than duplicating their checks. Read each description and inspect bodies where routing, overlap, or stale references need investigation. Without an inventory helper:

```bash
find -L .agents/skills -name SKILL.md | wc -l                      # total count, including symlinked skills
find -L .agents/skills -name SKILL.md -exec wc -l {} \; | sort -rn # by body length, including symlinked skills
```

Group by domain in a mental table (DB / state / UI / agent / testing / workflow / docs / etc.). Note new arrivals since last audit (`git log --since="1 week ago" -- .agents/skills/`).

### 2 — Detect overlap / redundancy

For each pair within the same domain, ask:

- **Same description**? → likely duplicate (one is probably a stale rename leftover, or a global-vs-local collision).
- **Trigger keywords substantially overlap**? → either merge, OR tighten one description so the model can choose unambiguously.
- **One skill's body says "see also: foo"**? → confirm `foo` still exists, AND confirm the cross-reference is still meaningful (the referenced skill may have absorbed the referrer's concerns).
- **Skill duplicates content from `AGENTS.md`**? → fold into AGENTS.md or slim the skill to just the delta.

Common false positives (do NOT merge):

- `db-migrations` vs `drizzle` — distinct workflows (migration files vs schema authoring).
- `agent-runtime-hooks` vs `agent-tracing` vs `agent-signal` — different surfaces of the agent system.
- `testing` vs `acceptance` — different test types.

### 3 — Description and invocation boundaries

Check whether the description makes the skill's purpose and selection boundary clear and matches its body. Flag broad triggers that attract unrelated tasks, missing distinctions between overlapping skills, and stale names or references.

Do not require literal phrases such as `Use when` or `Triggers on`, a fixed sentence structure, or a description length proportional to the body. These are writing choices, not runtime routing controls. Treat script wording heuristics as review hints, not proof of a defect.

Verify explicit-only invocation settings against the active harness's supported metadata, such as frontmatter `disable-model-invocation` or `policy.allow_implicit_invocation` in `agents/openai.yaml`. Do not assume different harnesses recognize the same fields. Preserve the intended policy; do not infer runtime behavior from description wording alone.

### 4 — Stale-skill check

For narrow domain skills (e.g. `response-compliance`, one-off CLI workflows):

```bash
# Confirm the referenced code surface still exists
rg -l "response-compliance|openresponses" packages/ src/              # adjust per skill
git log --since="3 months ago" -- .agents/skills/ < skill > /SKILL.md # is it being maintained?
```

If the underlying surface is gone and the skill hasn't been edited in 3+ months → flag for archival.

### 4b — Living-log freshness (`common-mistakes.md`, `probe-mock-patterns.md`)

Both layers (`.agents/skills/acceptance/references/` generic, `.agents/acceptance/`
project) are injected into every acceptance round, so a stale entry is a stale
instruction. For each entry:

```bash
rg -n '^`since|holds-while' .agents/acceptance/common-mistakes.md        # every entry must carry both
rg -n 'holds-while: (?!always)' -P .agents/acceptance/common-mistakes.md # the mechanism-bound ones
```

- Missing `since` / `holds-while` → the entry predates the admission rule; either add them or move it to field-notes.
- For every non-`always` `holds-while`, check whether the named mechanism still exists (the script default, the ingest gap, the platform behavior). Gone → delete the entry (PROCESS.md Step 0 exit rule); the field notes keep history.
- An entry that names a project script from the generic layer, or a product noun, is in the wrong layer.
- Duplicate ids (`rg -o '^### [ML]-?[A-Z]?\d+' | sort | uniq -d`).

### 5 — Cross-reference integrity

Any skill body mentioning another skill by name:

```bash
# Scan all skill bodies for skill-name references
rg -o '`[a-z][a-z0-9-]+`' .agents/skills/*/SKILL.md | grep -v ':\s*$' | sort -u
```

For each name extracted, confirm `.agents/skills/<name>/SKILL.md` exists. Broken references happen after renames — fix them in the same audit pass.

### 6 — Output report

Report actionable findings with file references, evidence, and the proposed change. Distinguish confirmed defects from uncertain candidates. Include inventory totals or an execution order only when they help the user decide; no fixed headings, template, or line-count estimates are required.

End by asking the user which actions to apply — do NOT auto-apply unless the user passed `--apply` and even then confirm destructive deletes individually.

## Output rules

- Be specific. "Skill X overlaps with Y" is useless without naming the overlapping triggers.
- Cite line numbers when flagging description / body issues.
- Don't recommend merges unless the call sites would actually load the merged skill in the same context.
- Don't recommend deletes for skills that haven't been touched recently — "unused" can mean "stable", not "dead".

## What NOT to do

- ❌ Don't rename skill directories without checking for cross-references AND user memory entries that name the old slug.
- ❌ Don't normalize a description by removing trigger keywords just to fit the template — the keywords are the routing signal.
- ❌ Don't fold a heavy 200+ line skill into another just because they share a domain — large skills get loaded selectively and merging makes everything load.
- ❌ Don't propose `.agents/skills/INDEX.md` or `<domain>-<skill>` prefix renames unless the user explicitly asks — costs > benefits for cosmetic reorgs.

## Related history

- First audit: `chore/skills-audit` branch (2026-05-25) — deleted `source-command-dedupe`, renamed `data-fetching` → `data-fetching-architecture`, normalized 9 descriptions, created this skill.

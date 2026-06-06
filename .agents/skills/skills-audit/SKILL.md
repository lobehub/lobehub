---
name: skills-audit
description: 'Audit .agents/skills SKILL.md files. Use for recurring checks of duplicate, overlapping, stale, inconsistent, or broken skills and merge/delete candidates.'
disable-model-invocation: true
argument-hint: '[--verbose | --apply]'
---

# Skills Audit

Periodic review of the project-local skill set under `.agents/skills/`. The goal is to catch drift before the catalog becomes confusing — too many skills, overlapping triggers, descriptions that no longer match the body, references to skills that were renamed/deleted.

**Recommended cadence:** weekly, or after any week where >1 skill was added/renamed.

## Procedure

### 1 — Inventory

Build a fresh census of all SKILL.md files. Do NOT trust any prior cached list.

```bash
find .agents/skills -name SKILL.md | wc -l                      # total count
find .agents/skills -name SKILL.md -exec wc -l {} \; | sort -rn # by body length
```

Group by domain in a mental table (DB / state / UI / agent / testing / workflow / docs / etc.). Note new arrivals since last audit (`git log --since="1 week ago" -- .agents/skills/`).

### 2 — Pull frontmatter for all skills

```bash
# Extract name + description for each SKILL.md
for f in .agents/skills/*/SKILL.md; do
  echo "=== $(basename $(dirname $f)) ==="
  awk '/^---$/{c++; next} c==1' "$f" | head -20
done
```

Read the description block of every skill. The body can stay unread unless step 4 flags it.

### 3 — Detect overlap / redundancy

For each pair within the same domain, ask:

- **Same description**? → likely duplicate (one is probably a stale rename leftover, or a global-vs-local collision).
- **Trigger keywords substantially overlap**? → either merge, OR tighten one description so the model can choose unambiguously.
- **One skill's body says "see also: foo"**? → confirm `foo` still exists, AND confirm the cross-reference is still meaningful (the referenced skill may have absorbed the referrer's concerns).
- **Skill duplicates content from `AGENTS.md`**? → fold into AGENTS.md or slim the skill to just the delta.

Common false positives (do NOT merge):

- `db-migrations` vs `drizzle` — distinct workflows (migration files vs schema authoring).
- `microcopy` vs `i18n` — content vs mechanics.
- `agent-runtime-hooks` vs `agent-tracing` vs `agent-signal` — different surfaces of the agent system.
- `testing` vs `local-testing` vs `cli-backend-testing` — different test types.

### 4 — Description format consistency

Apply the **standard template**:

```
{Topic + key conventions or scope}. Use when {scenarios — verbs + nouns}. Triggers on {`code-symbols`, 'natural phrases', '中文'}.
```

Skills with `disable-model-invocation: true` (user-invoked only, slash commands) don't need `Triggers on` — they're never auto-routed.

Flag descriptions that:

- ❌ Have NO `Use when` clause (model can't decide when to load it).
- ❌ Have NO `Triggers on` clause (and aren't `disable-model-invocation`).
- ❌ Use weird formats (numbered lists `(1)(2)(3)`, `Triggers:` colon instead of `Triggers on`, `MUST use when ...` as opening word).
- ❌ Are dramatically terse for a 200+ line body, or dramatically verbose for a 60-line body.
- ❌ Reference deleted/renamed skills.

### 5 — Stale-skill check

For narrow domain skills (e.g. `response-compliance`, one-off CLI workflows):

```bash
# Confirm the referenced code surface still exists
rg -l "response-compliance|openresponses" packages/ src/              # adjust per skill
git log --since="3 months ago" -- .agents/skills/ < skill > /SKILL.md # is it being maintained?
```

If the underlying surface is gone and the skill hasn't been edited in 3+ months → flag for archival.

### 6 — Cross-reference integrity

Any skill body mentioning another skill by name:

```bash
# Scan all skill bodies for skill-name references
rg -o '`[a-z][a-z0-9-]+`' .agents/skills/*/SKILL.md | grep -v ':\s*$' | sort -u
```

For each name extracted, confirm `.agents/skills/<name>/SKILL.md` exists. Broken references happen after renames — fix them in the same audit pass.

### 7 — Output report

Produce a markdown summary back to the user with the same structure as the original audit (this skill was created during one):

```markdown
## 📊 Inventory

{count, domain breakdown}

## 🎯 Recommendations

### 🔴 High confidence

- {action} — {reason}

### 🟡 Medium confidence

- {action} — {reason needs verification}

### 🟢 Low confidence / no-op

- {item considered but skipping because ...}

## 📋 Suggested order

{table of actions with risk + LOC estimate}
```

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

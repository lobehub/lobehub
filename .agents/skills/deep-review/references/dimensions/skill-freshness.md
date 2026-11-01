---
id_prefix: skill
verify: false
skip_when: never in deep mode (cheap)
---

# Skill Freshness

Agent skills are load-bearing documentation: agents follow them literally. A diff that changes behavior a skill describes silently poisons every future agent session. This dimension keeps the skill library in sync with reality and spots knowledge worth capturing. Findings are advisories — they skip the verify pass.

## Quick checklist

- Does this diff invalidate any skill? Renamed/moved files, changed commands, altered workflows, removed exports that a skill references by path or name
- Does this diff invalidate any statement in `AGENTS.md` / `CLAUDE.md` / `README` setup docs?
- Is this diff the kind of foundational work later tasks will build on (new subsystem, new convention, new tool) with no skill capturing it?
- Did this change fix a mistake class that keeps recurring? Root-cause knowledge belongs in a skill (or an update to the relevant dimension file of this review skill)

## How to check

1. Extract the diff's "renames and removals": file paths, exported names, npm scripts, CLI commands, env vars.
2. `rg` each old name across `.agents/skills/` and root-level agent docs (`AGENTS.md`, `CLAUDE.md`) — a hit on a removed/renamed thing is a stale-skill finding.
3. For new subsystems: check whether any existing skill's scope covers it; if none does and the subsystem has non-obvious workflow (setup steps, conventions, gotchas), propose a skill with a one-line scope.

## Violations (advisories)

- A skill or agent doc that now states something false, with the exact file and line quoted.
- A clearly skill-worthy gap: repeated-mistake class or foundational feature with no home. Propose the skill name and 2-3 bullet contents — concrete enough to act on, not "consider documenting this".

## Not violations

- Skills that are merely terse or could be "improved" without being wrong — freshness, not quality review.
- Speculative skills for one-off work unlikely to recur.

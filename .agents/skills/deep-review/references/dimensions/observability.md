---
id_prefix: obs
verify: true
skip_when: no error handling, async flow, or server code touched
---

# Observability

When this code misbehaves in production six months from now, can the person debugging it (possibly an agent) see what happened and why the code is the way it is?

## Quick checklist

- Bug fix without a comment explaining **why** the fix is needed, especially non-obvious workarounds — future readers will "simplify" it back into the bug; link the issue/PR when one exists
- Hacky or surprising code without a comment stating the constraint that forces it (and a reference link when the workaround comes from an upstream issue/SO answer)
- `catch` blocks that swallow errors: no log, no rethrow, no user feedback — silent failure is the most expensive kind
- Key paths (payment-like flows, data migration, auth transitions, cross-system calls) with no log line at decision points — success paths matter too, not just errors
- New logging uses the `debug` package with a proper `lobe-*` namespace, not stray `console.*`
- Log lines that would be useless when read cold: no identifiers (which user? which entity?), or dumping whole objects instead of the discriminating fields

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/debug-package/SKILL.md` — namespace conventions, format specifiers
- Repo `CLAUDE.md` / `AGENTS.md` comment rules — mandatory comment scenarios (complex logic, trade-offs, reference links)

## How to check

1. `rg "catch" <changed files>` — read every catch body added/modified by this diff; classify as logged / rethrown / surfaced / swallowed.
2. For each fix in the diff, look for the explanatory comment in the same hunk; check it explains _why_, not _what_.
3. Walk the main execution path of new server-side flows and count observable checkpoints.

## Violations

- A swallowed error, uncommented hack, or unexplained fix introduced by this diff.
- A new multi-step flow whose failure would be undiagnosable from logs alone.

## Not violations

- Missing logs on trivial pure functions or UI-only handlers with visible outcomes.
- Comment/log density matching equivalent existing flows (calibration principle) — except silent catches, which are always findings.
- Intentionally ignored errors that say so (`// ignore: <reason>`).

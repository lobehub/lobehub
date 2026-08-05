---
id_prefix: sec
verify: true
skip_when: lockfile/generated-only diff (docs, i18n copy, comments are leak vectors — never skip for text changes)
calibration_exempt: true
---

# Security

Injection, authorization, and leakage. **This dimension is exempt from the codebase-calibration principle**: a vulnerability is a finding even if the same weakness exists elsewhere in the repo, and severity is never downgraded for precedent.

## Quick checklist

- Injection: user input reaching SQL (raw `sql` fragments), shell commands, `dangerouslySetInnerHTML`, path construction
- Authorization: new TRPC procedures / API routes missing the auth middleware their siblings use; queries missing user-scoping (`userId` filter) that sibling queries apply
- Sensitive data in logs: API keys, tokens, credentials, full request bodies in `console.*` / `debug()` output
- No base64 blobs printed to terminal output (freezes output, may embed secrets)
- Hardcoded secrets — must come from environment variables
- New env vars holding secrets must not be exposed client-side (`NEXT_PUBLIC_*` review)
- SSRF: user-controlled URLs fetched server-side without allowlisting
- **Business-slot confidentiality**: `src/business/` and `packages/business/` must not expose commercial logic, pricing, or private infrastructure details in code or comments — slots export only minimal generic contracts and safe defaults

## Rule sources (deep mode: read before reviewing)

- Repo root `AGENTS.md` — security guide section (business slots, secret files)
- Sibling implementations of whatever the diff adds (the auth pattern of neighboring procedures is the yardstick for "missing auth")

## How to check

1. Trace every new external input (request params, user content, webhook payloads, env) to its sinks; look for an unescaped/unvalidated hop.
2. For each new procedure/route: open two sibling procedures in the same router and compare middleware and user-scoping.
3. `rg` the diff for `console.`, `debug(`, `NEXT_PUBLIC_`, `dangerouslySetInnerHTML`, raw `sql` template usage.
4. For business-slot files: read the diff as an outside contributor would — does any name, comment, or constant reveal private commercial behavior?

## Violations

- Any quick-checklist hit reachable by an attacker or visible in the open-source repo.
- Auth/scoping weaker than the established sibling pattern.

## Not violations

- Inputs fully constrained upstream (e.g. an enum validated at the boundary) — verify the constraint before dismissing, and cite it.
- Secrets in local-only, gitignored files referenced by name (that is their job) — but confirm the file is actually gitignored.

---
id_prefix: obs
verify: true
skip_when: no error handling, async flow, server code, new user-facing capability, or perf-sensitive path touched
---

# Observability

Three questions, one dimension — all about what we can see after this ships:

1. **Debug**: when this misbehaves six months from now, can the person debugging it (possibly an agent) see what happened and why the code is the way it is?
2. **Product**: will we know whether this feature is used, and will the data tell us what to build next?
3. **Performance**: if this gets slower or more expensive under real traffic, does anything notice?

The bar for 2 and 3 is deliberately narrow — most changes need neither. See the qualifying criteria in each section; a generic "should add tracking" suggestion is noise, not a finding.

## Quick checklist

### Debug

- Bug fix without a comment explaining **why** the fix is needed, especially non-obvious workarounds — future readers will "simplify" it back into the bug; link the issue/PR when one exists
- Hacky or surprising code without a comment stating the constraint that forces it (and a reference link when the workaround comes from an upstream issue/SO answer)
- `catch` blocks that swallow errors: no log, no rethrow, no user feedback — silent failure is the most expensive kind
- Key paths (payment-like flows, data migration, auth transitions, cross-system calls) with no log line at decision points — success paths matter too, not just errors
- New logging uses the `debug` package with a proper `lobe-*` namespace, not stray `console.*`
- Log lines that would be useless when read cold: no identifiers (which user? which entity?), or dumping whole objects instead of the discriminating fields

### Product analytics

The test is **not** "did we record that the user did something". It is: **is there a decision waiting on this data?** Instrument where the data closes a loop back into the product; skip where it would only produce a number nobody acts on.

Qualifying shapes — flag a missing `analytics?.track()` when the new capability is one of these:

- **User-supplied queries**: search, filters, command palette, any free-text input. The **misses are worth more than the hits** — a search that returns nothing is the strongest signal of what the product lacks. Capture the shape of the query, never its text: result count (0 is the event that matters), which filters/scope were active, input length, latency. A proposal that logs the raw query is out of bounds — see the PII bullet under "Not violations"; the miss rate answers the question without it
- **A new entry point or capability**: without adoption data there is no way to tell later whether to invest in it or delete it, and that question always comes up
- **A multi-step flow**: signup, checkout, onboarding, any wizard. Per-step events are what turn "conversion is bad" into "step 3 is bad"
- **A decision that was contested or reversible**: when the PR/issue records a disagreement or an explicit "let's try it and see", the event is what settles it later
- **A fallback or degraded path**: how often the fallback fires decides whether the primary path is worth fixing. An unmeasured fallback becomes permanent silently

Event quality, when one is added: a stable event name, and properties that make it sliceable (which surface, which variant, outcome). An event with no properties is a counter, and counters rarely answer the next question.

### Performance monitoring

Qualifying shapes — new or changed code on one of these paths should ship with a way to see its cost:

- **High-frequency interaction**: command palette, search-as-you-type, anything firing per keystroke or per render of a list
- **High-traffic entry**: home, landing, the first screen after auth. The denominator is enormous, so a small regression multiplies into a large one, and it is the least likely place for anyone to notice by hand
- **Polling or intervals**: total requests = users × frequency × session length, so this is a cost problem before it is a latency problem — and cost is invisible unless request volume is measured somewhere. (Whether the loop itself backs off, stops, and is tunable is `performance`'s call, not yours)
- **A new network call added to a synchronous or blocking path**, especially a model/LLM call or a third-party API whose latency we do not control
- **Rendering over unbounded data**: a list or computation whose size grows with real usage

What "a way to see its cost" means concretely: latency at a **percentile, not an average** (averages hide the tail that users actually feel), an error/timeout rate, and for polling, request volume. Backend paths go through the OTEL instrumentation in `packages/observability-otel`; front-end page-level cost is covered by Vercel Speed Insights, so a bespoke timer for a page load is usually redundant — say so rather than proposing one.

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/debug-package/SKILL.md` — namespace conventions, format specifiers
- Repo `CLAUDE.md` / `AGENTS.md` comment rules — mandatory comment scenarios (complex logic, trade-offs, reference links)
- `src/components/Analytics/` — the `analytics?.track()` provider and existing event shapes; match the conventions already in use before inventing a new event name
- `packages/observability-otel/` — backend tracing/metrics instrumentation

## How to check

1. `rg "catch" <changed files>` — read every catch body added/modified by this diff; classify as logged / rethrown / surfaced / swallowed.
2. For each fix in the diff, look for the explanatory comment in the same hunk; check it explains _why_, not _what_.
3. Walk the main execution path of new server-side flows and count observable checkpoints.
4. For any new user-facing capability, match it against the qualifying analytics shapes. If one matches, `rg 'analytics\?\.track'` around the feature to see whether it was instrumented; when proposing an event, name the event and the properties, and state the decision the data would inform — if you cannot name that decision, do not report it.
5. For any change on a qualifying performance path, find the interval/frequency/call site and state the arithmetic (per keystroke? per user per minute? × how many users?), then check whether that volume and its latency land anywhere someone could read after ship.

## Violations

- A swallowed error, uncommented hack, or unexplained fix introduced by this diff.
- A new multi-step flow whose failure would be undiagnosable from logs alone.
- A qualifying new capability shipped with no analytics event, where a named decision depends on that data — most sharply, a search/query surface that does not record misses.
- A new call on a high-traffic or high-frequency path — polling included — with no way to see its latency or volume after ship.

## Not violations

- Missing logs on trivial pure functions or UI-only handlers with visible outcomes.
- Comment/log density matching equivalent existing flows (calibration principle) — except silent catches, which are always findings.
- Intentionally ignored errors that say so (`// ignore: <reason>`).
- Missing analytics on anything that does not match a qualifying shape: visual/style changes, internal tooling, scripts, agent skills, refactors with no behavior change. "More tracking would be nice" is not a finding.
- Events that would duplicate what server logs or the database already record — the data exists, it just needs querying.
- Analytics proposals that would capture user content, identifiers beyond the existing convention, or anything PII-shaped. Do not propose those at all; if the diff already does it, that is a `security` finding, not this dimension.
- A bespoke timer for something Speed Insights or existing OTEL spans already cover.
- Perf instrumentation demanded for cold paths, admin screens, or one-off scripts.

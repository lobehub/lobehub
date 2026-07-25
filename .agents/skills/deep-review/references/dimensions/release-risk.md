---
id_prefix: risk
verify: true
skip_when: diff touches no DB schema/migration, no schemaless persisted payload, no queue/workflow payload or cron schedule, no config or env dependency, no outbound sender, no prompt/tool-description text, no shared component or package public API, no high-frequency user surface, and carries a single obvious purpose
---

# Release Risk

The last gate before shipping. Every other dimension asks "is this code correct?" — this one asks **"if we merge and deploy this today and it turns out wrong, how bad is the recovery?"** A change can be flawless and still be a bad thing to ship in one piece.

Seven risk classes, each with its own irreversibility profile:

1. **Persisted state** — wrong code can be reverted in minutes; wrong data cannot
2. **Dev-cycle drift** — a requirement that was reworked several times leaves residue in the migration history and in the dev database, and production will not replay that history
3. **Deploy-moment state** — work already in flight, and configuration that must exist before the code runs
4. **Prompt surface** — prompts are production behavior with no type system and no test that fails; a wording change reaches every conversation on the next request
5. **Rollback granularity** — whether undoing this means reverting a whole PR or flipping one switch
6. **Shared surface and high-frequency UI** — a base component, an exported API, or a screen every user touches daily multiplies any defect by its reach
7. **PR purity** — a PR carrying several unrelated sub-requirements can only be reviewed, approved, and rolled back as a single unit, at the risk level of its most dangerous part

Findings here are release decisions, not just defects: alongside `fix_options`, propose the de-risking move (split the PR, ship behind a flag, land the migration in a separate earlier PR, backfill in a separate job, stage the rollout).

## Two output shapes

Much of this dimension's subject matter is **not visible in the diff** — the shape of rows already in production, whether an env var is set in each deploy target, what is sitting in the queue right now. Do not force those into findings; asserting facts you cannot read is exactly the hallucination the verify pass exists to catch.

- **Finding** (the normal `issues` entry): you can point at the diff and argue the consequence. Use this whenever the evidence is in the code.
- **Release check** (the `release_checks` array): an objective pre-deploy confirmation item — "this change depends on X; confirm X before deploying". No severity, no verification, straight to the report as a checklist for the human. Use when the answer lives in production state or in a system outside the repo.

A release check is not a downgraded finding. If the code itself is wrong, it is a finding. If the code is fine but shipping it safely depends on something you cannot see, it is a check.

## Quick checklist

**Persisted state**

- New migration SQL, or a schema change that will generate one, is the part of the diff `git revert` cannot undo — so it always gets **read**, in full. But reading it is not reporting it: an additive, reversible migration (nullable column, new table, concurrent index) with no ordering hazard produces **no output at all** — not a finding, and not a release check either, because there is nothing for a human to confirm. It earns a finding through one of the specific hazards below, or a release check when shipping it safely depends on production state you cannot read (row counts, existing data shape, whether a backfill already ran)
- Destructive DDL: `DROP COLUMN` / `DROP TABLE` / `RENAME`, narrowing `ALTER COLUMN TYPE`, removing an enum value — old data is gone or unreadable once applied
- Data-mutating statements in a migration (`UPDATE` / `DELETE` over existing rows) with no dry-run count, no backup path, and no way to reconstruct the old values
- Constraints added to populated tables (`NOT NULL`, `UNIQUE`, `CHECK`, new FK) — these fail at deploy time on dirty production data that dev fixtures never contained
- `ON DELETE CASCADE` on a new FK: a single row deletion now silently removes rows in other tables
- **Schemaless persisted state changing shape** — the highest-miss-rate item here, because there is no DDL and no migration file, so it passes review invisibly. Old records keep the old shape forever and every reader must handle both. Carriers to check:
  - `jsonb` columns: keys added/renamed inside the column, or a value's type changed
  - Cache values: a Redis key whose stored payload is a structured object, not a scalar — nothing migrates it, and the old shape stays until the TTL expires (or forever, if there is none)
  - Client-side persistence: `localStorage`, IndexedDB, persisted store state. Worst case of all — the data lives on the user's machine, you cannot migrate it, and on desktop you cannot even force the client to update
  - Blobs in object storage: manifests and config JSON written by an older version
    Flag any writer-side shape change whose reader does not defend against the legacy shape, and say which carrier it is — the recovery options differ per carrier.
- Rollback asymmetry: after deploy, is reverting the code alone safe while the schema stays migrated? If the new schema breaks the previous code version, say so — that is a one-way door
- Deploy ordering: does the new code require the migration to have run first (or vice versa)? Name the required order

**Dev-cycle drift**

This class only exists because features get reworked. When a requirement went through several design iterations before landing, the branch accumulates two kinds of residue — one in the committed migrations, one in the developer's local database — and only the first is visible in the diff. Both are worth checking precisely on the PRs that feel most finished.

- **Dev-phase compatibility carried into production migrations.** Production has never seen the intermediate states of an unshipped feature, so a migration that adds a column, a later one that renames it, and a third that drops it are three statements where one belongs. Look for a migration series inside this PR that mutates objects the same PR created: `ADD COLUMN` then `DROP COLUMN`, a table created then renamed, a backfill for rows that only exist on someone's laptop, a `DROP ... IF EXISTS` guarding an object that never shipped. Recommend squashing into the final shape — the churn is not free: every extra statement is another lock, another failure point, and a false record of the schema's history
- **Migrations written to accommodate a dev database, not production.** Defensive clauses whose only purpose is to survive a local database in an unknown state (`IF EXISTS` on an object the migration itself just created, a delete-then-recreate to avoid a local conflict, a data fix-up for a shape only local iterations produced) should not ship. They are dead weight in production and they hide the real precondition
- **Local-only schema residue.** The counterpart risk: the developer's database still carries tables, columns, or enum values from an earlier version of the plan, so the code runs locally against objects that no committed migration creates. Production starts from the committed migrations only. Two checks — does the diff reference any table/column not present in the schema files, and would a clean database reach the same state by replaying the migration folder? What you cannot settle from the repo (what is actually sitting in someone's dev DB, whether the migration was regenerated after the last schema edit) goes to `release_checks` as "verify against a freshly migrated database"
- **Sequence and ordering damage from rebases.** A long-lived branch that was rebased repeatedly can end up with migration files whose ordering no longer matches the trunk's. The failure appears only when the trunk's migrations run first — which is to say, only in production

**Deploy-moment state**

- **In-flight async work**: queued messages and mid-execution workflows were produced by the _old_ code. A changed job/message payload shape, or added/removed/reordered workflow steps, meets messages already in the queue and workflows resuming from a step index that no longer means the same thing. `git revert` cannot recall a message already in flight — check that the consumer accepts the old payload for at least one deploy cycle, or that the change is drain-and-deploy
- **Scheduled jobs**: a cron whose schedule, idempotency assumptions, or scope changed — the next tick fires with production-scale data, not fixtures
- **New configuration dependency**: an env var, secret, feature flag, or third-party setting the new code reads. It is invisible in the diff by definition, and an unset value in one deploy target means a 5xx on boot. Check every target this repo deploys to, not just the one you're thinking of, and check the failure mode: does it crash loudly at startup, or fail silently at the first request?
- **Irreversible outbound side effects**: emails, push notifications, payment calls, third-party webhooks. Once sent, nothing recalls them. The dangerous shape is not the obvious "send email" endpoint — it is a backfill, migration, or bulk operation that _incidentally_ triggers a notification path for every touched row. Trace whether the new write path fans out to any outbound sender

**Prompt surface**

A prompt edit is a one-line diff that changes the product's behavior for every user, and it is the change class with the **weakest safety net in the entire repo**: no type checks it, no unit test fails on it, and code review reads it as prose rather than as the control logic it actually is. Treat any diff touching a system role, tool description, parameter description, or context-assembly template as a behavior change of the same weight as editing a core function — a reviewer nodding at "the wording reads better" is not review.

Where they live: `packages/prompts/src/prompts/**` (systemRole, tools, planning, memory, and the rest), each builtin tool's `manifest.ts` + `systemRole.ts` under `packages/builtin-tool-*/`, and the assembly/injection order in `packages/context-engine/`.

- **Tool and parameter descriptions are the model's only API documentation.** They decide _whether_ the model calls a tool, _when_, and \*with what arguments. Rewording a description to be clearer to a human can make a tool fire more or less often — the effect is statistical, invisible in the diff, and surfaces as "the agent got worse" days later with nobody linking it to this PR. Say which tool's selection rate the change can move, and in which direction
- **Removing or narrowing an instruction is riskier than adding one.** A sentence in a system prompt is usually there because something went wrong once. Deleting it as "redundant" re-opens whatever it was patching, and the commit that added it is the only record of why. Check `git log -S` on the removed sentence before accepting a deletion as harmless
- **Constraints and safety wording** (what the model must refuse, must not fabricate, must not expose) are enforcement, not tone. A weakened constraint is a `security` finding; the release angle is that it reaches production instantly with no gate
- **Assembly-order and injection-point changes** (where a fragment lands relative to tools, history, and user input) change behavior even when no word changes. A moved block is a real change, not a refactor
- **Persisted copies of prompts.** A default system role that was copied into user-owned records at creation time does not update when the default changes — existing agents keep the old text forever. Decide which is intended and say so; if the change is meant to reach existing records, that is a backfill, i.e. the Persisted-state class
- **Cost and cache.** Prompt text is paid on every request by every user, and prefix changes invalidate prompt caching. A longer system prompt is a spend change with no code path to point at — the arithmetic belongs to `observability`, but flag here that it ships with no gradual rollout
- **Validation.** A prompt change cannot be verified by reading it. What would show a regression — an eval run, a before/after transcript on a real case, a staged rollout? If the PR has none of the three, that is the finding. This is also the change class where a flag is most useful and most often skipped, because it looks like a text edit

**Rollback granularity (feature flags)**

The question is not "is a flag nice to have" — it is **what does undoing this cost, and can that cost be lowered**. Reverting a PR means a revert commit, a rebuild, a redeploy, and it takes everything else in that PR with it. Turning a flag off is seconds and surgical, and this repo can flip flags at runtime through edge config without a deploy at all (`packages/app-config/src/featureFlags/`, `packages/edge-config/`).

Recommend gating when **all** of these hold:

- The change alters a user-visible main path, and its bad outcome is "works, but wrong" rather than "crashes" — crashes get caught by monitoring, silent wrongness does not
- It cannot be fully validated before shipping: it depends on production data volume, real traffic patterns, or a third-party system
- Undoing it by revert is disproportionately expensive — the PR carries other work, or the revert would have to drag a migration with it

Also recommend one when the rollout should be staged (small cohort first, watch a metric, then widen) — that is a capability a revert cannot give you at all.

Do **not** recommend a flag when:

- It is a plain bug fix. Gating a fix keeps the buggy path alive and doubles the states to reason about
- The change is internal-only: scripts, dev tooling, agent skills, anything with no user-facing surface
- A migration is the risky part. **A flag does not gate a schema change** — the DDL either ran or it did not. Gating the _reader_ while the schema already changed is a false sense of safety; say so instead of proposing a flag
- An equivalent switch already exists — check before adding a second one for the same surface
- The flag plumbing would be more complex or longer-lived than the change it guards. Every flag is a branch someone must delete later; a flag with no removal condition is technical debt with a straight face

When you do recommend one, state the removal condition in the same breath: what observation makes it safe to delete the flag and the old path.

**Shared surface and high-frequency UI**

Two different multipliers, same class. A base component's reach is its call-site count; a high-frequency screen's reach is the number of users who hit it every day. The second one has no import graph to measure it, which is why it gets skipped.

High-frequency surfaces — the entry screen after auth, the main chat/work surface, the global navigation and sidebar, the command palette, the composer/input, anything on the path a user walks within seconds of opening the product:

- A defect here has no soak period. It is not "some users eventually"; it is everyone, within minutes of deploy, on the flow they use most
- Interaction changes on these surfaces cost more than their code suggests. Moved or removed controls, changed keyboard/shortcut behavior, a new confirmation step, an altered default, a changed submit/Enter semantic — users have muscle memory here, and "it still works, it just moved" is a support and trust cost that no revert undoes for people who already hit it
- The failure mode is usually _not_ a crash: layout that breaks at one viewport, a state that no longer restores, an action that silently does nothing. Monitoring does not catch these; users do
- This is the strongest case in the whole dimension for staged rollout or a flag, because it is the change whose bad outcome arrives fastest and reaches furthest
- Judge the _reach and reversibility_, not the design. Whether the new interaction is better belongs to `ux`; whether shipping it all at once is wise belongs here

Shared surfaces — measured by call sites:

- Files under `src/components/`, anything exported from a `packages/*` public entry, shared hooks/utils/contexts, and design-system wrappers — treat these as base surfaces regardless of how small the diff is
- Behavior change to an existing prop: new default value, changed fallback, altered event timing. Every existing call site silently inherits it without appearing in the diff
- Signature change: new required prop, renamed prop, narrowed type — breaks call sites; check whether all of them were updated, including `.desktop`/`.mobile` variants and other packages
- Cost added inside a base component (a new hook, effect, context subscription, observer, or per-render computation) — it is paid once per call site per render, so a "small" addition multiplies
- Extensibility regression: a variant hardcoded with an `if`/switch on a specific caller, or logic that belongs to one consumer pushed down into the shared component — the next variant can only be another branch
- Visual/interaction regression radius: a style or layout change in a base component reaches surfaces nobody listed in the PR description

**PR purity**

- Count the independent sub-requirements in the diff (group by domain/feature, not by file count). Two or more that could each stand alone is the signal to look closer
- Recommend a split when: a sub-requirement is large or high-risk on its own, **and** it has no compile-time or runtime dependency on the rest of the diff
- Mixed risk levels in one PR: a DB migration or base-component change riding along with copy tweaks or unrelated refactors. The whole PR now inherits the highest risk level for review, approval, and rollback
- Drive-by refactors, formatting sweeps, or dependency bumps that bury the actual change — reviewers cannot separate intent from noise, and a rollback takes the unrelated work with it
- A PR whose description lists one goal but whose diff implements several

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/db-migrations/SKILL.md` — rollout strategy, online index creation, backfills, what makes a migration safe
- `.agents/skills/drizzle/SKILL.md` — schema conventions, what generates a migration
- `.agents/skills/upstash-workflow/SKILL.md` — workflow/queue semantics, what a step change means for runs already in progress
- `.agents/skills/pr/SKILL.md` — stacked-PR workflow and layer ordering; the concrete mechanics for any split you recommend
- `.agents/skills/react/SKILL.md` — component layering, which surfaces count as shared
- `.agents/skills/builtin-tool/SKILL.md` — manifest/description conventions, how a tool's text reaches the model
- `.agents/skills/agent-tracing/SKILL.md` — pulling real transcripts, the only way to show a prompt change's before/after

## How to check

1. **Persisted state**: list every migration file and schema change in the diff. For each statement, ask three questions — does it destroy or rewrite existing data; does it fail on production data that fixtures lack; can the previous code version still run against the new schema? Then find the schemaless writes: grep the diff for `jsonb` column writes, cache `set` calls with object payloads, and client-persistence writes, and compare each written shape against what its reader accepts.
2. **Dev-cycle drift**: read the PR's migration files **in order as a series**, not one at a time, and ask what a clean database ends up with — any object created and then altered/renamed/dropped within the same PR is churn to squash. Then cross-check the schema files against the code: every table/column the diff reads or writes must be created by a committed migration, not assumed to exist. If the PR history shows several rounds of rework, add a `release_checks` item to replay the migrations on a fresh database before deploying.
3. **Deploy-moment state**: grep the diff for changed job/message payload types and workflow step definitions; for each, ask what happens to an item enqueued five minutes before deploy. Then collect every config value the new code reads (`process.env`, env schema files, flag lookups) and check whether the diff also adds it to the example/schema files — an env var read but never declared is a release check at minimum. Finally, trace new bulk write paths for outbound senders (mail, notification, payment, webhook).
4. **Prompt surface**: read every changed prompt string as a **behavior diff**, not as copy — for each edit, say what the model did before and what it will do now. Removed or weakened sentences get `git log -S '<removed phrase>'` to recover why they were added. For a tool/parameter description, name the tool and the direction of the selection-rate change. Then check the PR for any evidence of validation (eval, transcript, staged rollout); none of the three on a user-facing prompt is itself the finding.
5. **Rollback granularity**: for the riskiest change in the diff, write the actual undo procedure in one sentence. If that sentence is "revert the PR and redeploy" and the change is user-visible and unvalidatable, ask whether a flag is warranted against the criteria above — and check whether one already exists for that surface before proposing a new one.
6. **Shared surface**: for each touched file that qualifies as a base surface, count its call sites (`rg -l "from '.*<Component>'"` or the package's import graph) and state the number in the finding — blast radius is the evidence. Then diff the props/behavior contract, not just the implementation.
7. **High-frequency UI**: for each changed user-facing surface, place it on the user's path — how soon after opening the product is it reached, and can the flow be completed without it? For anything on the first-minute path, state what a user with existing habits experiences on the first load after deploy, and whether that experience is recoverable without a redeploy.
8. **PR purity**: cluster the changed files by domain and name each cluster's sub-requirement in one phrase. For any cluster you propose splitting out, prove independence by checking that nothing outside it imports what it adds — an unprovable split is not a finding.
9. For every finding, state the recovery cost explicitly: what it takes to undo this after it reaches production.
10. Whatever you could not settle from the repo alone — production data shape, whether a config value is set per target, current queue depth — goes to `release_checks`, phrased as something a human can confirm in one action. Never guess it into a finding.

## Severity and likelihood calibration

This dimension is the easiest one to turn into a rubber stamp that blocks every PR touching the database. Hold the line:

- **p0** — genuinely unrecoverable: destructive DDL with no backup or reconstruction path, a migration that will fail against real production data, or a schema change that breaks the currently deployed code with no compatibility window. "Cannot be undone after deploy" is the bar, not "involves SQL".
- **p1** — recoverable but expensive: a reader that will throw on legacy-shaped records, a consumer that rejects payloads already in the queue, a base-surface contract change with call sites left unupdated, an independently shippable large sub-requirement bundled in, a first-minute-path interaction change shipped all-at-once with no gate, a prompt edit that removes an existing constraint or moves a tool's selection behavior with nothing validating it.
- **p2** — advisory: split suggestions for smaller sub-requirements, mixed risk levels, missing rollback notes on an otherwise safe change, migration churn to squash.

Purity findings cap at p1 and are normally `blocks_release: false` — a split is a process improvement, not a shipping blocker, unless the bundled part is itself a p0 risk.

Prompt findings sit at p1 by default. p0 only when the edit removes a safety/refusal constraint or breaks a contract another system parses (a tool schema, a structured-output format) — "the model may behave differently" is p1 at most, because it is recoverable by a redeploy even though the outputs it already produced are not.

`likelihood` here means **how likely the risk materializes**, not how often the code runs. A migration executes exactly once with certainty, but whether it damages anything depends on the production data: `high` when the hazard depends on data that certainly exists (any populated table), `medium` when it depends on data shapes we plausibly have, `low` when it needs a state the product has probably never produced.

## Violations

- An irreversible or hard-to-reverse data change shipped without a stated rollback/backfill plan or deploy ordering.
- A schemaless shape change (jsonb, cache payload, client persistence, stored blob) whose readers do not handle records written before it.
- A payload or workflow-step change that breaks items already enqueued or mid-run at deploy time.
- A bulk write path that fans out to an outbound sender with no guard on volume or recipient set.
- A migration series inside this PR that ships the development iteration itself — an object created then renamed or dropped by a later migration in the same PR, or a defensive clause that exists only to survive a local database.
- Code that reads or writes a table/column no committed migration creates.
- A prompt edit that deletes or weakens an existing instruction without recovering why it was added, or that changes a tool/parameter description in a way that moves when the model calls it — shipped with no eval, no before/after transcript, and no staged rollout.
- A prompt or assembly-order change presented as a wording cleanup or refactor when it changes what the model does.
- A default prompt change that is meant to reach existing user-owned records but has no backfill, or that silently does reach them when it should not.
- A base-surface change whose blast radius (named call-site count) exceeds what the PR description and tests account for.
- A change to a first-minute user path (entry screen, main work surface, navigation, composer, command palette) that alters an established interaction and ships ungated, where the failure mode is silent rather than a crash.
- A PR bundling an independently shippable, large-or-risky sub-requirement that has no dependency on the rest.
- An unvalidatable, user-visible main-path change shipped with revert as its only undo, where a flag would have made the undo surgical.

## Not violations

- Additive, reversible schema changes that ship with the code that uses them: a nullable column, a new table, a new index created concurrently. Adding a column is not a finding merely because it touches the database.
- Lock duration, migration idempotency, and query cost — those belong to the `performance` dimension. Report the data-safety and reversibility angle here and do not restate the locking analysis.
- A new env var that the diff also declares in the env schema and example files, with a sane default or a loud startup failure — that is a release check at most, not a finding.
- Cache payload changes on a key with a short TTL where the reader tolerates a miss: the old shape drains on its own. Say so instead of reporting it.
- A missing feature flag on a change that is small, verifiable before shipping, or cheap to revert. "Could be flagged" is not a finding — only "revert is the only undo and revert is expensive" is.
- Genuinely non-behavioral prompt edits: a typo, a broken template variable, formatting, or a translation of text the model never reads differently. Not every string in a prompt file is a prompt.
- Prompt changes that are themselves the requirement, where the PR states the intended behavior change. Review the rollout (validation, reach, what already-produced outputs look like), not whether the new instruction is the right one — that is a product decision.
- Whether the new wording is well written, better structured, or more token-efficient — that is `code-style` and `observability`. This dimension asks only what happens to users on the next request and how it is taken back.
- Multiple migrations in one PR that each do a distinct, forward-only thing — a series is only churn when a later statement undoes or reworks what an earlier one in the _same PR_ created.
- Idempotency guards (`IF NOT EXISTS` / `IF EXISTS`) on objects the migration did not create — those are the repo's convention and belong to `performance`'s idempotency rule, not here. Only guards protecting against a state that exists solely on a developer's machine are a finding.
- Whether a UI change is a good design, whether the new copy reads well, whether the interaction is discoverable — that is `ux`. This dimension judges only how far and how fast a bad outcome would spread, and what it costs to pull back.
- A high-frequency surface touched in a purely additive or internal way: a new optional element, a refactor with no interaction change, a style fix. Reach alone is not a finding; a changed established behavior on that reach is.
- Whether a shared abstraction is the _right_ one, or duplicates an existing implementation — that is `reuse-architecture`. This dimension only judges the blast radius of changing it.
- PR description drift and issue/CI state — that is `workflow`. Purity is about the diff's internal composition, not its paperwork.
- A large diff that is large because one requirement genuinely spans many files. Size alone is never a purity finding; independence is the test.
- Splits that would create a broken intermediate state — a stacked PR whose lower layer does not build or deploy on its own is worse than one honest PR.

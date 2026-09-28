# Common Mistakes (generic layer)

> **This is the GENERIC layer of the living log.** It ships with the skill, so a
> consumer repo's copy is materialized and read-only — change it by PR to the
> skill source. Every entry must be **product-independent**: no project's
> packages, routes, schemas, env vars, service names, or business logic. Those go
> to `.agents/acceptance/common-mistakes.md`, the writable project layer.

## How this file is injected

A mistake catalogue works by having been read — you cannot search for a failure
mode you do not yet know you are about to hit. But the rule is what must be in
context, not the narrative. So the file has two tiers, read at two moments:

| Tier          | Read                                                                                      | When                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Checklist** | in full — one line per mistake                                                            | once the target is known, and again before marking any case `pass` or the round done |
| **Entries**   | by id — `rg -n '^### M' <file>` for line numbers, `sed -n '<start>,<end>p'` for one entry | when a checklist line applies to a case, or a reviewer's feedback matches one        |

Only **judgment** rules live here — the ones no tool can check. Rules an agent
skips under pressure are in SKILL.md ("Rules you will be tempted to skip");
rules a validator or a script default can enforce are removed the day that
code lands. Every entry therefore carries `since` (first observed) and
`holds-while` (the mechanism it depends on; `always` means pure judgment). An
entry whose `holds-while` no longer holds is deleted, not kept as reference.

Apply the same shape to the project layer's file. Never narrate the reading.

## Checklist

- **M1** Open every screenshot with Read before `pass`; greps and element counts never decide. Presence/absence of a UI section is asserted on structured state, never on page text.
- **M5** Before/after is a `comparison` pair with exactly one `before` and one `after`; never a stale shot loose in `evidence`, never a hand-composed image, never sequential flow steps.
- **M6** Prove the running instance loads your working-tree code by measuring a changed value. After a direct fixture write, cold-load and assert at the layer the behavior reads, not where you wrote.
- **M12** A UI chip/badge is supporting evidence; the payload, request body, DB row, or side effect is the proof.
- **M13** A GIF's last frame is its headline — end on the asserted state or say in `observation` why it ends elsewhere.
- **M14** GIF at source resolution, per-frame palette, no dithering on neutral UI; inspect first/middle/last frames.
- **M15** A changed shared component is verified on every surface that renders it; skipped surfaces are marked untested.
- **M16** A change inside a bar/row with overflow is verified in default and collapsed/overflow state.
- **M22** An error-state case needs the failed status AND the user-facing message in the same screenshot.
- **M28** Non-visual behavioral claims carry two text artifacts in the same round: reasoning, then execution record.
- **M30** Electron evidence is the visible viewport, never `screenshot --full`.

## Entries

### M1 — Judging `pass` from heuristics instead of the screenshot

`since 2026-07-17` · `holds-while: always`

**Trap:** deciding "renders fine" from `innerText` greps plus an element/skeleton
count. Layout-shell text is always in the DOM and a blank page also has zero
skeletons, so both false-positive. The mirror is worse: grepping page text to
prove a feature is _absent_ matches your own report prose naming it.

**Rule:** every screenshot cited as evidence is opened with the Read tool and
visually confirmed first. Blank / watermark / shell-only = fail or uncertain; go
find the cause. Presence or absence of a UI section is asserted against the state
that drives it or a located DOM node, never a substring.

### M5 — Before/after that is not a comparison pair

`since 2026-07-17` · `holds-while: ingest does not reject a comparison id with a missing or duplicated half`

**Trap:** a stale "before" shot loose in a passed case's `evidence` (the page
headings each image by filename, so it reads as the current result); two shots
hand-composed into one image; or two sequential steps of a flow tagged as
`before`/`after`.

**Rule:** one view in two states = a `comparison` pair with a shared `id`,
exactly one `before` and one `after`, one pair per case; the page owns the
labeling. Flow steps are ordered evidence with captions. Shape in
[report.md](./report.md#beforeafter-comparison-pairs).

### M6 — Verifying against a build or cache that is not your code

`since 2026-07-17` · `holds-while: always`

**Trap:** driving a resident or packaged instance and eyeballing the first
screenshot as "changed" — it serves a built snapshot, not your working tree.
Same shape one layer down: writing a fixture to the DB, reloading, and filing the
stale value the persisted client cache still serves as a product bug.

**Rule:** verify in an instance that loads your code, and prove it by measuring a
known-changed value before trusting any screenshot; restart non-hot-reloading
layers (server, main process, adapters) and prove which code they run. After a
direct fixture write, cold-load (clear client storage, re-seed auth) and assert
the fixture in the store before anything downstream —
[probe-mock-patterns.md](./probe-mock-patterns.md) B.

### M12 — Verifying the UI state but not the effect

`since 2026-07-17` · `holds-while: always`

**Trap:** an "inject context / apply setting / send data" feature is marked verified
because the chip or badge showed, while a later transport gate dropped it.

**Rule:** assert the last mile — the transformed request body, the DB row, the
downstream call. UI state is supporting evidence.

### M13 — A GIF that ends on an expected-failure frame

`since 2026-07-17` · `holds-while: always`

**Trap:** a loading/streaming GIF records through to the terminal error the test
data inevitably produces; it loops on that frame and reads as the case failing.

**Rule:** end the GIF on the asserted phase, or make a static shot the primary
evidence. If the terminal state is worth showing, say so in `observation` before
the viewer sees it.

### M14 — One global palette destroys neutral UI

`since 2026-07-17` · `holds-while: the GIF encoder in use does not default to per-frame palettes without dithering`

**Trap:** downscaling by default and encoding with one shared 256-color palette
plus dithering turns pale skeletons and thin borders into speckle.

**Rule:** keep source resolution, generate palettes per frame, disable dithering
for neutral UI, inspect first/middle/final frames at readable size. Downscale only
when file size forces it.

### M15 — Verifying only the entry surface of a shared component

`since 2026-07-17` · `holds-while: always`

**Trap:** a shared component changed; one surface is screenshotted; the same
component composed with different wrappers elsewhere still shows the old
behavior.

**Rule:** enumerate every surface that renders it, attach separate evidence for
each, mark skipped surfaces blocked or untested.

### M16 — Default state only, never collapsed / overflow

`since 2026-07-17` · `holds-while: always`

**Trap:** a change inside a toolbar/action bar/list row is checked expanded only; a
narrower container or a saved collapsed preference hides the affordance.

**Rule:** force and capture both states.

### M22 — A status badge is not the error message

`since 2026-07-17` · `holds-while: always`

**Trap:** a `Failed` badge is on screen, the error alert with the translated
message is not, and the case passes.

**Rule:** an error-presentation case requires the failed status AND the alert
containing the expected user-facing text in the same screenshot. An unrelated
warning does not count.

### M28 — Explanation and raw output as interchangeable text evidence

`since 2026-08-03` · `holds-while: ingest does not warn on a non-visual case with fewer than two text artifacts`

**Trap:** only a polished explanation with no observations; only a green
transcript the reviewer must infer a claim from; or the explanation in one round
and the logs in a later one.

**Rule:** two ordered text artifacts per non-visual behavioral case — a reasoning
document (claim, setup/threat model, attempt, pass criteria, interpretation,
limitations) and an execution document (exact command/request, raw observations,
mapping to the criteria). Republish both in every follow-up round.

### M30 — Full-page screenshot of an Electron window

`since 2026-08-16` · `holds-while: ingest does not flag a desktop screenshot whose aspect ratio or black margin is implausible`

**Trap:** `agent-browser screenshot --full` follows the renderer's document
extent, not the `BrowserWindow`, producing a giant mostly-black image in which
the UI is a tiny corner.

**Rule:** capture the visible viewport without `--full` (or the project's CDP
window-capture helper). Open the image; reject it if the app occupies a small
fraction or black margins dominate. Never crop evidence in post-processing.

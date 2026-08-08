# Grow — discoverability & progressive disclosure

How the product **deepens** as the user's needs deepen.

Part of the **ux** skill — see [`../SKILL.md`](../SKILL.md). Each checklist item is
tagged with the design value(s) it serves.

## 5.1 Progressive disclosure・Growth

The product should grow with the user — deeper power shows up as needs deepen. Keep the
novice path clean and reveal advanced capabilities as the user gets there, don't dump
everything at once. Surface related actions at the moment of need — make the next
capability discoverable in context (e.g. after the first item exists, offer what to do
with it), not buried in a far-off menu.

**Checklist**

- [ ] Advanced capability progressively disclosed; novice path stays clean. _(Growth・Natural)_
- [ ] Next action surfaced in context at the moment of need. _(Growth・Meaningful)_

## 5.2 Multi-step flows show progress and stay skippable・Certainty・Natural

A wizard / onboarding / any sequence of **more than two steps** owes the user two things a
single form doesn't: **where am I and how much is left** — a step / progress indicator (the
_Sequence Map_ pattern: position + total) on every step — and **a way out** — non-essential
steps (identity, optional profile, connectors) must be **skippable**, with an escape hatch
that is always visible, not buried behind a mode / branch flag. Without a progress signal the
flow reads as open-ended and users abandon; without a skip, an optional step becomes a hard
gate that blocks first use. This is a **surface-class norm** for setup flows (Notion / Linear
/ Slack / Vercel all ship both) — an absent progress bar or a mandatory profile step leaves no
`file:line` to grep, so name it as an expected capability and check it as present / missing.

> ✅ An onboarding wizard shows "Step 2 of 5" (or a progress bar) on every screen and lets the
> user skip the name / interests / connectors steps. ❌ LobeHub onboarding runs up to 6 classic
> / 4 desktop screens with **no progress indicator** (the only `<Steps>` are decorative feature
> lists, `current={null}`), and the classic flow **hard-gates on a required name** with no skip
> until the final step (`FullNameStep.tsx`, `_layout/index.tsx`) — see the onboarding audit.

**Checklist**

- [ ] A multi-step flow (>2 steps: wizard / onboarding) shows a step / progress indicator — position + total — on every step. _(Certainty・Natural)_
- [ ] Non-essential steps are skippable and an escape hatch is always visible, not gated behind a mode / branch flag. _(Natural)_

## 5.3 Close the config → manage loop with a near entry point・Growth・Meaningful

When a **settings / config surface governs a feature that owns its own data or management
area** — a toggle for Memory that has a whole `/memory` browser, an integration switch whose
connections live on another page, a "sync enabled" that has a sync-history view — the config
surface must offer a **near, in-context entry point to that area** ("Manage memories →",
"View connections", "Open history"). Configuring a thing and _using / inspecting_ it are two
ends of one loop; a settings pane that only flips a switch is a **dead-end** for the user who
now wants to see what it did. Describing the destination in helper copy ("you can view and
edit anytime") without linking to it is worse than silence — a promise with no door. This is a
**cross-surface** gap, so a single-surface / code-only read is structurally blind to it (the
link that should exist has no `file:line`); name the destination as an expected capability and
check the entry point is present. The management area may be reachable elsewhere (a global
nav item) — that doesn't discharge the obligation; the loop must close **from the config
context**, at the moment the user is thinking about the feature.

> ❌ Settings **Memory** (`/settings/memory`) is a bare enable-toggle + effort slider whose
> copy promises "view / edit / clear memory anytime" (`memory.enabled.desc`), yet renders **no
> link** to the rich `/memory` area (identities / contexts / preferences / experiences /
> activities) — the user configures memory and is given nowhere to go manage it. ✅ Add a
> "Manage memories →" action (header extra / footer row) to `/memory`, making the promised
> destination one click away.

**Checklist**

- [ ] A config surface for a feature with its own data / management area links to it in-context (close the config → manage loop), not just describe it in copy. _(Growth・Meaningful)_
- [ ] The destination is named as an expected capability up front (cross-surface gap has no `file:line`); a global-nav path elsewhere doesn't excuse the missing near entry point. _(Certainty)_

## 5.4 A borrowed keyboard/CLI idiom must be real, not decorative・Certainty・Natural

When a control **looks like** a known keyboard idiom — numbered `1`/`2`/`3` choice chips, a
`⌘K` badge, arrow-key list navigation, a keycap-styled shortcut hint — users who know that
idiom **will press the key**. The look is a promise. So either **wire the key** (the digit
selects the option, `⌘K` opens the palette, `↑/↓` moves the highlight) or **restyle it so it
reads as a plain ordinal / label**, never a keycap. A chip that mimics a CLI keycap but has no
handler is a false affordance — worst of all when the surface is a **port of a CLI flow**
(Claude Code / Codex), because the user arrives already trained on those keys and the silent
no-op reads as a bug. This is discoverability's inverse: 5.1 is about revealing a real
capability; this is about **not advertising one that isn't there**. Whether the keys fire is a
runtime fact — confirm it at **L3** (press the key), not from the chip's styling.

> ✅ An option row rendered as a keycap (`⌘1`, or a mono `1` chip) responds to that key;
> a purely ordinal marker is set in body text (not a bordered mono keycap) so it promises
> nothing. ❌ The CC AskUserQuestion option cards render a mono `1`/`2`/`3` chip in
> `fontFamilyCode` that reads as a keycap (`OptionCard.tsx` `optionIndex`), mirroring the
> Claude Code CLI where those digits _are_ the selection keys — but **no keydown handler
> exists** anywhere in the panel (`builtin-tool-claude-code/.../AskUserQuestion/*`; the
> Enter/1/2 shortcuts live only in the unrelated `ApprovalActions.tsx`). Pressing 1/2/3 or
> Enter does nothing — see the global-approval audit. Fix: wire the digit keys to toggle
> options and Enter to submit (guarded inside the free-text boxes), or drop the keycap styling.

**Checklist**

- [ ] A control that borrows a keyboard/CLI idiom (numbered choices, `⌘K`, arrow-nav, keycap hints) actually wires those keys — or is restyled so it doesn't imply an absent shortcut; especially in a surface ported from a CLI, where the user already knows the keys. Confirm the keys fire at L3. _(Certainty・Natural)_

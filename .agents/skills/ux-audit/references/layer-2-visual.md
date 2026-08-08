# Layer 2 — Visual audit (screenshots of the rendered surface)

L1 proves what's in the code; **L2 judges what the user actually sees.** Many verdicts —
visual hierarchy, spacing, truncation, whether an empty state reads as a real page — can
only be reached from a render. Add this layer whenever findings are about layout,
hierarchy, rendered states, or responsive behavior.

Part of the **ux-audit** skill — see [`../SKILL.md`](../SKILL.md).

> **This is the layer that fixes the recurring trap:** don't conclude "one primary button"
> or "empty is a real page" from a `variant` prop. On the render, confirm the dominant
> control _is_ the primary action, and the empty body _is_ a purpose-built page.

## Getting the screenshots

- **User-supplied** — the fastest anchor; a screenshot pasted into the chat is enough for a
  first pass. Ask for the specific state/viewport you're missing.
- **Captured via agent-testing** — `agent-browser --cdp 9222 screenshot` renders from the
  renderer (works headless under `xvfb-run`). See the **agent-testing** skill for launch +
  auth (its Step 0). Capture the states you need; forcing hard-to-reach states (error,
  empty) is an L3 job (see [layer-3-dynamic.md](layer-3-dynamic.md)).
- **Verify before citing.** Open every screenshot with the **Read tool** and confirm it
  shows what you claim _before_ writing a finding — same rule agent-testing uses for
  evidence. A cited screenshot you didn't look at is a vibe, not evidence.

**Capture the set, not one frame:** the default state, plus (where reachable) empty /
loading / error, at desktop + one narrow / mobile width, and dark + light if both ship.

## What to check on the render

- **Visual hierarchy & dominant control** — is the single most prominent control the
  primary action? Is there exactly one? (Read §3.2, but as _seen_.)
- **Layout & rhythm** — spacing consistency, alignment, grouping; does the eye land where
  intent wants it (Center Stage)?
- **Legibility & contrast** — text/background contrast, small-text density, icon-only
  controls without labels.
- **Truncation / overflow / wrapping** — long titles, big numbers, long lists; does content
  clip, push layout, or wrap badly? (pairs with Read §1.5 number formatting.)
- **Rendered data states** — does the empty state actually look like a purpose-built page
  with a CTA? Is loading a chrome-preserving skeleton or a bare block? Is the error state
  present and clear? (Read §1.1, Feedback §4.1.)
- **Selection visibility** — is the active item visible, or off-screen below a fold? (Read
  §1.3.)
- **Responsive** — at a narrow width, does anything collapse, overlap, or lose an action?
- **CLS — qualitative only here.** A before/after pair (or a GIF) can _show_ the layout
  jump, but **quantifying** it needs L3 instrumentation. Flag the symptom; hand the number
  to L3.

## Output contribution

Per finding: the checklist item / catalog pattern, the **screenshot** (path or the
user-supplied image) as evidence, and the remedy. Mark anything time-based (a layout jump,
streaming) as **"needs L3 (GIF / metric)"**.

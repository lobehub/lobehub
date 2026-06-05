# Design Review — LobeHub

**Date**: 2026-06-05 | **Register**: Product | **Surface**: Full app shell (global styles, layout container, home, chat, onboarding)

---

## First Impression

**Score: 5/10**

The redesign is competent but anonymous. The box-shadow container frame and muted base backgrounds (`#f5f5f5` / `#0d0d0d`) are professional but say nothing about LobeHub specifically. If you swapped the logo for Slack's, nothing would look wrong — that's the problem. The surface reads "well-built web app," not "Chief Agent Operator."

The framed content area is a cleaner version of the old bordered frame, not a distinct spatial language. It's a reliable surface but it has no memory.

---

## Hierarchy

**Score: 7/10**

The composition serves the Operate pattern well: NavPanel sidebar → framed container → content. Chat messages have a clear scanning rhythm (avatars left, messages centered, user bubbles right-indented with `paddingInlineStart: 36`). The onboarding flow has a logical progression.

**Weakness**: The home page flattening to solid `colorBgContainer` removed the gradient that previously differentiated the content area from the browser chrome / desktop window background. On desktop (where the outer container is transparent), the content area and window background merge into a single visual plane. The squint test is harder now — there's one less depth cue.

**Miss**: The container frame uses `box-shadow: 0 0 0 1px` as a border replacement, which works but doesn't convey the "precision operator" mood named in the redesign. A precision instrument would have a deliberate edge — this reads as "border, but rendered differently."

---

## Color Voice

**Score: 4/10**

The project has no authored color identity. Every surface passes through antd-style tokens with no curation. The light background `#f5f5f5` is slightly warmer than white; the dark `#0d0d0d` is slightly lighter than black. That's the full extent of the color decision.

The brief says "no generic SaaS palette" and "no blue-violet CTAs" — but the system doesn't assert what it IS. Users pick from 13 primary colors and 6 neutrals via `ThemeSwatchesPrimary` and `ThemeSwatchesNeutral`, but there is no curated default. The out-of-box experience inherits whatever antd provides as its default primary color.

This is pragmatic for a theme-customizable product, but it means the first-visit impression has zero point of view. Color is the fastest signal of intent and this surface has no signal.

**Evidence**: No custom theme defaults are set anywhere. The `AppTheme.tsx` component passes `primaryColor ?? defaultPrimaryColor` and `neutralColor ?? defaultNeutralColor` — but those defaults resolve to antd's stock blue/gray palette.

---

## Type Voice

**Score: 6/10**

System fonts are legitimate for product UI — the brief is right about that. No authoring was needed on the font stack.

But there is no type scale. Font sizes are chosen ad-hoc per component: `28px` for onboarding headings, `14px weight-500` for chat titles, `12px` for hints and secondary text. There's no `fontSize` token map, no modular scale, and no relationship between sizes across components. A `Text fontSize={14}` in one file and a `fontSize={16}` in another have no governed connection.

The shimmer loading animation was tuned (wider sweep, softer highlight via `colorTextQuaternary`), but the type it decorates wasn't considered as a system. The highlight underline in `text.ts` uses a `color-mix` blend which integrates better with body text — that's a good micro-decision, but it's a lone bright spot.

---

## Interaction Feel

**Score: 6/10**

The tightened ChatItem hover (150ms from 200ms), the scrollbar fade-in on hover, and the loading indicator glow are all deliberate improvements over the old state. Controls feel slightly more responsive.

**Gaps**:
- **Modal masks**: `rgba(token.colorBgLayout, 0.5)` with `backdrop-filter: blur(2px)` still uses the old glass-surface treatment. This reads as "the old design peeking through" — inconsistent with the deliberate edges of the new container frame.
- **No focus rings**: The custom style files define no focus ring system. `@lobehub/ui` components handle their own, but no authored focus style exists for custom elements.
- **State coverage**: The 9 states (idle, hover, active, focused, loading, empty, error, disabled, overflow) are partially covered. ChatItem handles hover, active, and loading. The home page handles empty (no agents state). Missing: explicit disabled state styling for controls in this codebase, error state recovery UI, overflow truncation strategy beyond the existing `lineEllipsis`.
- **Scrollbar regression**: `will-change: opacity` was removed from the body. The hardware acceleration comment said "otherwise render black edges will appear" — without it, there's a risk of rendering artifacts on certain platforms.

---

## Smell Check

1. **Token pass-through identity** — the entire visual system is antd tokens with a `lobe-vars` prefix. Every color, every radius, every spacing value is inherited. This is a "default design system" smell — the product looks like the library, not like itself.

2. **Shadow-as-border** — using `box-shadow: 0 0 0 1px` for the container frame is a competent technique but a generic reflex. It says "I want a hairline border that doesn't take layout space." It doesn't say "this is a precision operator console."

3. **Missing authored defaults** — the theme system supports custom primary and neutral colors, but ships with antd stock defaults. The brief explicitly rejects generic SaaS palettes, yet the default experience is exactly that.

---

## Scoring Summary

| Lens | Score | Notes |
|---|---|---|
| First impression | 5/10 | Professional but anonymous. No memorable point of view. |
| Hierarchy | 7/10 | Sound layout structure serves Operate and Onboarding. Flat content plane loses depth cue. |
| Color voice | 4/10 | Pure token pass-through. No authored color identity or curated defaults. |
| Type voice | 6/10 | System fonts are correct. No type scale or governed size relationships. |
| Interaction feel | 6/10 | Responsive controls. Inconsistent surface language. Missing focus and state coverage. |
| **Total** | **28/50** | |

---

## Top Issues (ordered by impact)

1. **No color identity (Color, 4/10)** — Highest impact fix. The system inherits antd defaults without asserting a product voice. Establish a default primary/neutral palette that carries the "Chief Agent Operator" authority.

2. **Flat depth model (Hierarchy, 7→8)** — Content and background planes merge on the home page. Needs at least one depth cue to differentiate the working surface from the window.

3. **No type scale (Type, 6/10)** — Ad-hoc font sizes across components create visual inconsistency. A 4-5 step modular scale would cost nothing and tighten the entire surface.

4. **Inconsistent surface language (Interaction, 6/10)** — Modal masks still use old glass-blur treatment. The container frame and modal overlay should belong to the same world.

5. **Missing interaction states (Interaction, 6→7)** — Focus rings, disabled states, and error recovery UI are addressable gaps.

---

## Recommendations

| Priority | Mode | Target |
|---|---|---|
| 1 | `recolor` | Establish authored default primary + neutral palette. Set color voice. |
| 2 | `surface` | Harden modal masks, add focus ring system, complete state coverage (disabled, empty, error). |
| 3 | `typeset` | Define governed type scale. Replace ad-hoc font sizes with scale steps. |
| 4 | `relayout` | Re-differentiate background plane from content plane on home page. Restore depth cue. |
| 5 | `refine` | Polish the box-shadow frame into a deliberate edge language that reads as "precision instrument." |

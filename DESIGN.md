---
version: alpha
name: LobeHub
description: LobeHub's design system, built on lobe-ui (@lobehub/ui). Tokens are themeable — primary and neutral colors are user-configurable and resolve to CSS variables (cssVar key `lobe-vars`). This is the Light theme; the Dark theme uses the same token names with different values and is documented in DESIGN.dark.md.
themeable:
  # Users pick a primary and a neutral; components must read the semantic tokens
  # below rather than hard-coding any single value from this list.
  primaryColor:
    default: ~ # monochrome (near-black in light) when unset — see colorPrimary
    options:
      [red, orange, gold, yellow, lime, green, cyan, blue, geekblue, purple, magenta, volcano]
  neutralColor:
    default: ~ # the built-in `gray` scale when unset
    options: [mauve, slate, sage, olive, sand]
colors:
  # Semantic tokens (lobe-ui token names) — the real contract components consume via
  # `cssVar.colorPrimary`, `cssVar.colorText`, etc. Light-theme defaults shown.
  colorPrimary: '#222222' # monochrome by default; becomes the chosen primaryColor[9]
  colorSuccess: '#379d4a' # green
  colorWarning: '#ee9e0b' # gold
  colorError: '#ec5e41' # volcano
  colorInfo: '#0072f5' # geekblue
  # Text — solid neutrals from the `gray` scale; rank info with these
  colorText: '#080808' # primary text and icons
  colorTextSecondary: '#666666' # secondary text, labels
  colorTextTertiary: '#999999' # placeholder, captions
  colorTextQuaternary: '#bbbbbb' # disabled
  # Surfaces — separate scale from text; never substitute one for the other
  colorBgLayout: '#f8f8f8' # page background
  colorBgContainer: '#ffffff' # primary card / panel surface
  colorBgContainerSecondary: '#fbfbfb' # subtle secondary surface (lobe-ui custom token)
  colorBgElevated: '#ffffff' # popovers, menus, modals
  colorBgSpotlight: '#dddddd' # tooltips
  # Borders & fills — translucent, layer over any background
  colorBorder: '#e3e3e3' # stronger edge
  colorBorderSecondary: '#eeeeee' # default divider / subtle border
  colorFill: 'rgba(0, 0, 0, 0.12)'
  colorFillSecondary: 'rgba(0, 0, 0, 0.06)'
  colorFillTertiary: 'rgba(0, 0, 0, 0.03)' # hover wash
  colorFillQuaternary: 'rgba(0, 0, 0, 0.015)' # active wash
elevation:
  # Shared by both themes; pair each with the matching radius
  boxShadowTertiary: '0 3px 1px -1px rgba(26, 26, 26, 0.06)' # raised cards
  boxShadowSecondary: '0 8px 16px -4px rgba(0, 0, 0, 0.2)' # popovers, menus
  boxShadow: '0 20px 20px -8px rgba(0, 0, 0, 0.24)' # modals, dialogs
typography:
  fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, "HarmonyOS Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif'
  fontFamilyCode: '"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Code", Consolas, "HarmonyOS Sans SC", monospace'
  # Body & label scale (lobe-ui)
  fontSizeSM: 12 # captions, dense metadata
  fontSize: 14 # default body and UI text
  fontSizeLG: 16 # emphasis, large controls
  fontSizeXL: 20
  lineHeight: 1.5714 # ~22px at 14px
  lineHeightSM: 1.6667 # ~20px at 12px
  # Headings
  fontSizeHeading1: 38
  fontSizeHeading2: 30
  fontSizeHeading3: 24
  fontSizeHeading4: 20
  fontSizeHeading5: 16
  fontWeightStrong: 600
spacing:
  # 4px base scale (lobe-ui padding/margin tokens)
  XXS: 4
  XS: 8
  SM: 12
  base: 16
  MD: 20
  LG: 24
  XL: 32
radius:
  borderRadiusXS: 4 # tags, chips
  borderRadiusSM: 6 # inputs, small controls
  borderRadius: 8 # default — buttons, cards
  borderRadiusLG: 12 # menus, modals, large surfaces
controls:
  controlHeightSM: 28
  controlHeight: 36 # default (lobe-ui base)
  controlHeightLG: 40
---

# LobeHub

## Overview

LobeHub is an AI-native product suite (chat, agents, tools). Its design system is built on **lobe-ui** ([@lobehub/ui](https://github.com/lobehub/lobe-ui)) — LobeHub's own component and theming layer — and is themed at runtime through `ThemeProvider` with the cssVar key `lobe-vars`.

The aesthetic is calm and content-first: generous whitespace, restrained color, and a near-neutral canvas so the conversation and the user's content stay in focus. Color carries state and hierarchy, not decoration. Every surface is designed for both light and dark appearance and for desktop and mobile.

Two things make this system different from a fixed palette, and both matter when you build with it:

1. **It is themeable.** Users choose a **primary** color and a **neutral** color. Never hard-code a hex value from this file — read the **semantic token** (e.g. `cssVar.colorPrimary`, `cssVar.colorText`) so your UI follows the user's theme and adapts between light and dark automatically.
2. **It has design values.** LobeHub follows four product values — **Natural · Meaningful · Certainty · Growth** — that decide trade-offs the tokens can't. They are summarized under [Design Values](#design-values) and are the tie-breaker when guidance conflicts.

The YAML above lists the default **Light** theme. The Dark theme redefines the same token names with different values and lives in **[DESIGN.dark.md](./DESIGN.dark.md)** — every other section here (typography, layout, motion, shapes, components, voice, values) is theme-independent and applies to both. Build against token names, not values.

> **Scope — this file is the design _system_, not the interaction playbook.** DESIGN.md covers what the product looks and sounds like: tokens (color, typography, elevation, radius), the component inventory, and Voice & Content. It deliberately does **not** cover how a flow should behave over time. For any **interaction detail** — empty / loading / error states, lists at scale, selection & scroll restoration, pickers, number formatting, draft safety, action momentum & confirm flows, button hierarchy, entity lifecycle, capability guardrails, progressive disclosure — consult the **ux** skill (`.agents/skills/ux/`). Rule of thumb: **static look & wording → here; dynamic behavior → the ux skill.**

## Design Values

The philosophy behind every LobeHub interface. Read these before designing a flow.

- **Natural** — Minimize cognitive load. The next step should be obvious without thinking; carry the user forward with sensible defaults, AI assistance, and smooth transitions rather than making them stop and figure things out.
- **Meaningful** — Root every screen in the user's real goal. Make the objective clear, give immediate feedback on each action, and always point at the next meaningful step.
- **Certainty** — Low-entropy, predictable interactions. Reuse the same patterns, components, and wording. Keep one clear focus per surface and design **every** state — empty, loading, error, success. Restraint over cleverness.
- **Growth** — The product grows with the user. Surface advanced capability progressively, revealing features at the moment they become relevant without crowding the novice path.

**Priority when values conflict** (moment-to-moment interaction): **Meaningful ≳ Natural > Certainty** — never sacrifice the user's goal or forward momentum just to keep things uniform. **Growth** is a longer-horizon lens for how a feature is discovered and scales, not a single-screen layout call.

## Colors

LobeHub uses lobe-ui's **semantic token** model. A token's name encodes its **role**, so the same name resolves to the right value in light, dark, and under any user theme. Always consume tokens by name — `cssVar.colorText`, `cssVar.colorBgContainer`, and so on.

**Text** uses solid neutrals from the `gray` scale that hold contrast on any surface — rank information with them rather than reaching for color:

- `colorText` — primary text and icons
- `colorTextSecondary` — secondary text, form labels
- `colorTextTertiary` — placeholders, captions, metadata
- `colorTextQuaternary` — disabled

**Surfaces** are a separate scale from text; do not swap one for the other. `colorBgLayout` is the page canvas, `colorBgContainer` is the primary card/panel surface, `colorBgContainerSecondary` gives subtle separation, `colorBgElevated` backs popovers, menus, and modals, and `colorBgSpotlight` backs tooltips.

**Borders and fills** are translucent (`rgba`/alpha), so they layer over any background. Use `colorBorderSecondary` for the everyday divider and `colorBorder` for a stronger edge; use the `colorFill*` ramp for hover/active washes (`colorFillTertiary` hover, `colorFillQuaternary` active).

**Functional color** is reserved for meaning: `colorPrimary` for the single most important action, focus, and links — note it is **monochrome by default** (near-black in light, near-white in dark) and only takes on a hue when the user picks a primary color, which keeps the default UI calm; `colorSuccess`, `colorWarning`, `colorError`, `colorInfo` for state. Each functional and accent color also exposes a derived ramp — `color{Name}`, `color{Name}Hover`, `color{Name}Active`, `color{Name}Bg`, `color{Name}Border`, `color{Name}Text`, and `color{Name}Fill*` — so you can build tinted backgrounds, borders, and text without picking raw values.

**Applying tokens in components.** The text ramp and the functional tints are full token sets, but component prop shorthands expose only part of them — so apply the token directly when no shorthand covers it. In `@lobehub/ui`, the `Text` `type` prop accepts `secondary | success | warning | danger | info` only (there is no `tertiary` / `quaternary`), and `Tag` `color` has no `primary`. For `colorTextTertiary` / `colorTextQuaternary` text, and for any `colorPrimary` or functional tint a shorthand lacks, set the token via `color={cssVar.colorTextTertiary}` (or a styled class) instead of `type="tertiary"` / `color="primary"` — the invalid prop values fail silently (rendered as a literal color or ignored), not with an error.

## Typography

**Geist** sets UI and prose; **Geist Mono** sets code, data, and tabular figures. The stacks above fall through to `-apple-system`, then **HarmonyOS Sans SC** and platform CJK faces, so Latin and CJK text stay visually consistent.

Use the scale tokens rather than setting size, weight, or line height by hand:

- **Body & labels** — `fontSize` (14px) covers most UI and body text; `fontSizeSM` (12px) for captions and dense metadata; `fontSizeLG` (16px) for emphasis and large controls. Line height is generous (\~1.57) for readability. The body/label scale is **12 / 14 / 16** — there is **no 13px token**. Some legacy UI hard-codes `fontSize={13}` for secondary text; treat that as drift and round to 12 or 14, and rank text with the `colorText*` opacity ramp rather than reaching for an in-between size. Don't introduce new off-scale sizes.
- **Headings** — `fontSizeHeading1`–`fontSizeHeading5` (38 → 16px) title pages and sections; pair with `fontWeightStrong` (600).
- **Code & numbers** — the `fontFamilyCode` stack; prefer tabular figures when numbers must align.

## Layout

Spacing follows a **4px scale** via lobe-ui padding/margin tokens: `XXS` 4, `XS` 8, `SM` 12, base 16, `MD` 20, `LG` 24, `XL` 32. Keep a clear rhythm — tight space inside a group (8px), more between groups (16px), most between sections (24–32px). Cards use 16–24px padding.

The 4px scale governs **gaps, padding, and margins** — and only those. Two things are deliberately **not** on it: **radius is a separate scale** (see [Shapes](#shapes); it includes a 6px step, `borderRadiusSM`), so never reuse a radius value as spacing; and **icon pixel sizes** (12 / 14 / 16 / 18 / 20) and 1px hairline borders are dimensions, not spacing. Off-scale spacing values (6, 10, 13…) are drift — round to the nearest scale step. Reserve a one-off off-scale value for genuine optical tuning, never as a default.

Layouts must work across appearances and form factors: every surface ships **light and dark** and **desktop and mobile** variants. Mobile is not an afterthought — `src/routes/(mobile)` and `.mobile`/`.desktop` component variants exist for exactly this. Center primary content and let side padding grow at wider breakpoints.

## Elevation & Depth

Hierarchy comes from **tonal surfaces and borders first**, so shadows stay subtle. Lift only what genuinely floats:

- Raised cards / panels: `boxShadowTertiary`, barely-there — most cards need none, just a `colorBorderSecondary` edge.
- Popovers and menus: `boxShadowSecondary`.
- Modals and dialogs: `boxShadow`, the strongest tier.

The shadow tokens are **shared across light and dark** — only the surface and border colors change between themes. Tooltips take the lightest treatment on `colorBgSpotlight`. Pair each elevation with the matching radius below, and prefer a border over a shadow when both would read.

## Motion

Motion clarifies change; it is never decoration. It is also **user-controllable** — LobeHub exposes an animation mode (`agile` ≈ 0.05 motion unit, default ≈ 0.1, or fully `disabled`), so motion must degrade gracefully and you must honor `prefers-reduced-motion` by dropping nonessential animation.

When motion helps — revealing, moving, or connecting elements — keep it short and physical: roughly 100–200ms for state changes and popovers, up to \~300ms for overlays and modals. Avoid long, looping, or attention-grabbing animation. For AI/loading moments, prefer the system's purpose-built loaders (skeletons, `NeuralNetworkLoading`) over ad-hoc spinners.

## Shapes

Radii stay soft but tight, and one family per view:

- `borderRadiusXS` 4px — tags, chips
- `borderRadiusSM` 6px — inputs, small controls
- `borderRadius` 8px — the default, for buttons and cards
- `borderRadiusLG` 12px — menus, modals, large surfaces

Reserve fully round (`9999px`) for pills, avatars, and circular icon buttons. Don't mix rounded and sharp corners in one view.

## Components

Prefer the system's components over bespoke markup, in this order:

1. **`@lobehub/ui/base-ui`** — headless primitives, first choice for new code (`Select`, `Modal` / `createModal` / `confirmModal`, `DropdownMenu`, `ContextMenu`, `Popover`, `ScrollArea`, `Switch`, `Toast`, `FloatingSheet`).
2. **`@lobehub/ui`** root — richer composed components when base-ui has no counterpart.

When base-ui has the component, use it — don't reach for the root version, and only drop to an underlying primitive when lobe-ui has no counterpart at all.

Default control height is **36px** (`controlHeight`); use `controlHeightSM` 28px and `controlHeightLG` 40px for the other sizes. Buttons follow lobe-ui's hierarchy — one **primary** (`colorPrimary` fill) per view for the most important action, **default** (surface fill + `colorBorder`) for ordinary actions, **text/link** for low-emphasis, and **danger** (`colorError`) for destructive actions. Hover and active states step through the `colorFill*` / `color{Name}Hover` ramps; disabled uses `colorTextQuaternary` text with a not-allowed cursor. Every interactive element shows a visible focus ring at `:focus-visible`.

Style components with lobe-ui's styling layer: prefer `createStaticStyles` with `cssVar.*` (zero-runtime) and fall back to `createStyles` + `token` only when styles need runtime computation.

## Voice & Content

Copy is part of the design — precise, calm, and free of filler. The voice is youthful, friendly, and modern on the surface; professional, reliable, and control-first underneath (reference points: Notion, Figma, Apple, Discord, OpenAI). Keys live in `src/locales/default`; LobeHub ships en-US and zh-CN by hand, so write a source string that translates cleanly without expanding much in length.

The brand promise is **For Collaborative Agents** — reinforce that LobeHub is not about one-shot "generation" but a collaborative agent system: shareable context, traceable outcomes, replayable runs, evolvable setup, and human-in-the-loop. Three principles to bake into structure and wording:

- **Create** — idea to usable Agent in one sentence, with a clear next step.
- **Collaborate** — multiple agents and people aligned on the same shared Context, controlled and manageable.
- **Evolve** — Agents remember preferences only with consent and get more helpful over time; keep it explainable, editable, and replayable.

### Terminology

One concept maps to **one term** site-wide — never alternate synonyms (no "bot / assistant / AI agent" drift for **Agent**). Canonical terms: **Workspace**, **Agent**, **Agent Profile**, **Group**, **Context**, **Memory**, **Integration**, **Skill**, **Topic**, **Page**, **Community**, **Resource**, **Library**, **MCP**, **Provider**, **Evaluation**, **Benchmark**, **Dataset**, **Test Case**. Prefer plain words ("connect", "run", "context") over jargon; when a technical term is unavoidable, gloss it in plain English.

### Writing rules

- **Clarity first** — short sentences, strong verbs, few adjectives. No hype ("revolutionary", "epic", "100%").
- **Layered, not split** — one main line that is simple and actionable, plus an optional second line (subtitle, helper text, tooltip) for precision or boundaries. Don't ship "simple vs pro" variants.
- **Consistent verbs** — reuse the same verb for the same action everywhere: Create / Connect / Run / Pause / Retry / View details / Clear Memory.
- **Always actionable** — every message tells the user what to do next. Name actions with a verb and a noun (`Create Agent`, `Delete Session`), never a bare `Confirm`, `OK`, or `Submit`.
- **Confirm outcomes** by naming the specific thing that changed; skip "successfully" and superlatives.
- **Empty states** point to the first action ("No agents yet. Create one to get started."), not a blank screen.
- **In-progress** states use a present participle with an ellipsis (`Generating…`, `Saving…`).

### Human warmth

Reduce anxiety and restore control without being sentimental. Default to **80% information, 20% warmth**; at key moments (first run, empty state, long waits, failures, data-loss risk, collaboration conflicts) up to **70/30**. Hard cap: at most half a sentence to one sentence of warmth, always followed by a clear next step. Order every sensitive message as:

1. Acknowledge the situation, without judgment.
2. Restore control — pause, replay, edit, undo, clear Memory, view Context.
3. Give the next action (button or path).

Avoid preachy encouragement ("don't worry"), grand narratives, and over-anthropomorphizing ("I understand you", "I'll always remember you"). The stance: Agents accelerate output, but the user owns the judgment and the final decision.

Sample patterns:

- **Getting started** — "Starting with one sentence is enough. Describe your goal and I'll set up the first Agent."
- **Long run** — "Running… You can switch tasks; I'll notify you when it's done." / "This may take a few minutes. To speed up: reduce Context or switch model."
- **Failure** — "That didn't run through. Retry, or view details to fix the cause." / "Connection failed. Re-authorize in Settings, or try again later."
- **Collaboration** — "Align everyone to the same Context — every Agent in the Group works from the same page."

### Errors and exceptions

Every error states **what happened**, optionally **why**, and **what to do next**. Offer concrete recovery — Retry / View details / Go to Settings / Contact support / Copy logs — rather than a dead end. Never blame the user, never show only an error code (put codes under "Details"). For data, security, and billing, stay neutral and thorough; here warmth comes from clarity, not emotion.

## Do's and Don'ts

- **Do** read semantic tokens (`cssVar.colorText`, `cssVar.colorPrimary`, …); they adapt to the user's theme and to light/dark. **Don't** hard-code hex values from this file.
- **Do** rank information with the text-opacity scale (`colorText` → `colorTextTertiary`). **Don't** signal state with color alone — pair it with an icon or label.
- **Do** keep solid `colorPrimary` for the single most important action and for state. **Don't** spread brand color as decoration.
- **Do** design all four data states — empty, loading, error, success. **Don't** ship only the happy path.
- **Do** build light + dark and desktop + mobile for every surface. **Don't** treat mobile or dark as an afterthought.
- **Do** keep `colorBg*` (surfaces) and the text/`colorFill` scales distinct. **Don't** swap a surface token for a text token.
- **Do** reach for `@lobehub/ui/base-ui` first, then `@lobehub/ui`. **Don't** rebuild a component the system already provides.
- **Do** honor `prefers-reduced-motion` and the user's animation mode. **Don't** add long or looping animation.
- **Do** hold WCAG AA contrast (4.5:1 for body text) and show a visible `:focus-visible` ring. **Don't** remove an outline without a visible replacement.
- **Do** keep one radius family and at most two font weights per view. **Don't** mix rounded and sharp corners.

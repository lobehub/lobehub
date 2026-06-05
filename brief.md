# LobeHub Design Constitution

## Register

**Product.** The interface is an instrument for daily work, not a brand experience. Operators who open this daily should move without thinking.

## Users

AI-savvy operators managing multiple agents simultaneously. They switch contexts fast, demand speed and control, and are often technical. They arrive to monitor agent activity, operate teams, configure behaviors, and explore what's possible. Their pressure is cognitive — too many agents, too many contexts, too little time.

## Purpose

LobeHub organizes agents into 7×24 operation. It hires, schedules, and reports on entire AI teams. Agents are the unit of work.

## Voice

Authoritative but frictionless. "Chief Agent Operator" — the system is in charge of orchestration, not the user. Copy is direct, specific, and names the actual work (not "loading..." but "Starting agent group run"). No exclamation points, no marketing filler, no "please" or "thank you" in UI copy. Sentence case everywhere.

Technical but not sterile. The product is for operators who know what they're doing — explain what's happening, not what the feature is.

## Anti-References

- **No generic SaaS palette.** Not cream, purple, or blue-violet. No blue-purple-to-cyan gradients.
- **No centered hero + card grid + pill buttons.** That composition pattern is refused unless the work genuinely demands it.
- **No Inter/Roboto/Plus Jakarta by reflex.** System fonts and the existing antd-style token system are the baseline.
- **No terminal aesthetic.** Not a dark developer tool despite the technical audience.
- **No corporate enterprise formality.** Not navy-and-white. Not sterile dashboards.

## Composition Lanes

The product spans multiple work patterns. Each screen needs a dominant lane:

- **Monitor** — Agent feeds, activity timelines, status dashboards, metrics. Live priority.
- **Operate** — Chat interface, command bar, agent interaction, direct manipulation.
- **Configure** — Settings, agent builder, provider setup, memory configuration. Grouped settings with clear commit areas.
- **Explore** — Community agents, skills marketplace, model discovery. Search, filters, galleries, reversible discovery.
- **Create** — Image generation, content creation, Pages editor. Canvas or workspace with tools.

Cards are allowed only when content is genuinely card-shaped: discrete, self-contained, scannable as a unit. One card inside another is never right.

## Visual Foundation

- **CSS-in-JS**: `antd-style` with `createStaticStyles` + `cssVar.*` (zero-runtime). Only fall back to `createStyles` when styles genuinely need runtime computation.
- **Components**: `@lobehub/ui/base-ui` first (headless primitives), then `@lobehub/ui`, then antd as last resort.
- **Theming**: Light/dark/system via `next-themes`. Primary color swatches built into `@lobehub/ui`. Antd token system drives all color roles.
- **Base colors**: Light mode background `#f8f8f8`, dark mode background `#000`. Desktop overlays use `colorBgLayout` with transparency.
- **Scrollbars**: Thin, token-colored, transparent track, visible on hover.
- **Border radius**: Token-driven via `cssVar.borderRadius`.
- **Electron**: Drag regions managed via `-webkit-app-region`. Desktop background has transparency for window effects.

## Accessibility

- Light/dark/system theme support built in.
- Focus management handled by `@lobehub/ui` components.
- Touch targets must be minimum 44×44px for mobile layouts.
- All states must be designed: idle, hover, active, focused, loading, empty, error, disabled, overflow.

## Component Rules

- Zero-runtime static styles preferred everywhere. Runtime `createStyles` only when values are computed.
- No inline styles except for truly dynamic values (e.g., progress bar width from data).
- Import from feature exports, not deep paths.
- Style files co-located with their component (`style.ts` next to component).
- When a single file exceeds ~800 lines, split it.

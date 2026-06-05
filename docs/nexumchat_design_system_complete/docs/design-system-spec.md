# nexumChat Complete Design System Spec

This spec is implementation-ready and contains exact values. It intentionally contains no citation artifacts.

## Brand rule

The product name is **nexumChat**. The first letter is lowercase, and the `C` in Chat is uppercase. Any other casing is incorrect.

## Product positioning

nexumChat is a power-user AI workspace: bring your own API keys or local models; nexumChat provides the UI, chat management, agents, plugins, knowledge bases, and workflow orchestration.

## Visual direction

- Primary mode: ultra-premium dark interface.
- Texture: glassy surfaces, subtle ambient glows, deep navy/black backgrounds, high-contrast typography.
- Logo/system motif: connected node paths, orchestration, multi-model routing.
- Avoid: generic robot heads, bubbly chatbot mascots, default speech bubbles.

## Exact color palette

### Dark theme

| Token | Hex/RGBA | Use |
|---|---:|---|
| `--color-bg` | `#050711` | App background |
| `--color-bg-subtle` | `#080B18` | Secondary page background |
| `--color-surface` | `#0C1020` | Cards, panels |
| `--color-surface-2` | `#10162A` | Inputs, selected nav |
| `--color-surface-3` | `#151D33` | Elevated surface |
| `--color-surface-glass` | `rgba(12,16,32,.72)` | Glass panels |
| `--color-border` | `#26304A` | Standard border |
| `--color-border-subtle` | `#1A2238` | Soft border |
| `--color-text` | `#F8FAFC` | Primary text |
| `--color-text-muted` | `#C8D0E2` | Secondary text |
| `--color-text-subtle` | `#8B96B3` | Captions/meta |
| `--color-text-disabled` | `#566178` | Disabled text |
| `--color-primary` | `#3B82F6` | Primary action |
| `--color-primary-hover` | `#60A5FA` | Primary hover |
| `--color-primary-active` | `#2563EB` | Primary pressed |
| `--color-accent` | `#D946EF` | Magenta accent |
| `--color-accent-2` | `#22D3EE` | Cyan accent |
| `--color-success` | `#34D399` | Success |
| `--color-warning` | `#FBBF24` | Warning |
| `--color-danger` | `#FB7185` | Error/destructive |
| `--color-info` | `#60A5FA` | Info |
| `--color-focus` | `#A78BFA` | Focus ring |
| `--color-scrim` | `rgba(2,6,23,.72)` | Modal backdrop |

### Light theme

| Token | Hex/RGBA | Use |
|---|---:|---|
| `--color-bg` | `#F7F9FC` | App background |
| `--color-bg-subtle` | `#EEF3FA` | Secondary background |
| `--color-surface` | `#FFFFFF` | Cards, panels |
| `--color-surface-2` | `#F8FAFF` | Inputs, nav selection |
| `--color-surface-3` | `#EEF2FF` | Elevated surface |
| `--color-surface-glass` | `rgba(255,255,255,.78)` | Glass panels |
| `--color-border` | `#D8E0EF` | Standard border |
| `--color-border-subtle` | `#E8EDF7` | Soft border |
| `--color-text` | `#111827` | Primary text |
| `--color-text-muted` | `#334155` | Secondary text |
| `--color-text-subtle` | `#64748B` | Captions/meta |
| `--color-text-disabled` | `#94A3B8` | Disabled text |
| `--color-primary` | `#2563EB` | Primary action |
| `--color-primary-hover` | `#1D4ED8` | Primary hover |
| `--color-primary-active` | `#1E40AF` | Primary pressed |
| `--color-accent` | `#C026D3` | Magenta accent |
| `--color-accent-2` | `#0891B2` | Cyan accent |
| `--color-success` | `#059669` | Success |
| `--color-warning` | `#B45309` | Warning |
| `--color-danger` | `#E11D48` | Error/destructive |
| `--color-info` | `#2563EB` | Info |
| `--color-focus` | `#7C3AED` | Focus ring |
| `--color-scrim` | `rgba(15,23,42,.40)` | Modal backdrop |

### Gradients

- Brand gradient: `linear-gradient(135deg,#22D3EE 0%,#3B82F6 28%,#8B5CF6 58%,#D946EF 78%,#FF7A59 100%)`
- Soft panel gradient: `linear-gradient(135deg,rgba(34,211,238,.18),rgba(139,92,246,.16),rgba(217,70,239,.14))`
- Ambient glow: `radial-gradient(circle at 20% 20%,rgba(34,211,238,.20),transparent 34%), radial-gradient(circle at 80% 10%,rgba(217,70,239,.18),transparent 36%)`

## Typography scale

Font stack: `Satoshi Variable, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif`.

| Token | px | rem | Line-height | Weight | Letter spacing | Use |
|---|---:|---:|---:|---:|---:|---|
| `display` | 56 | 3.5 | 64 / 4rem | 700 | -0.045em | Hero/title |
| `h1` | 40 | 2.5 | 48 / 3rem | 700 | -0.035em | Page title |
| `h2` | 32 | 2 | 40 / 2.5rem | 650 | -0.03em | Section title |
| `h3` | 24 | 1.5 | 32 / 2rem | 650 | -0.02em | Card title |
| `title` | 20 | 1.25 | 28 / 1.75rem | 650 | -0.01em | Dialog/card headings |
| `body` | 16 | 1 | 24 / 1.5rem | 400 | 0 | Default text |
| `body-strong` | 16 | 1 | 24 / 1.5rem | 600 | 0 | Emphasized body |
| `small` | 14 | 0.875 | 20 / 1.25rem | 400 | 0 | Secondary text |
| `caption` | 12 | 0.75 | 16 / 1rem | 500 | 0.02em | Labels/meta |
| `code` | 13 | 0.8125 | 20 / 1.25rem | 400 | 0 | Code snippets |

## Spacing scale

| Token | px | Use |
|---|---:|---|
| `space-0` | 0 | Reset |
| `space-025` | 2 | Hairline gaps |
| `space-050` | 4 | Dense icon/text gaps |
| `space-075` | 6 | Compact control gap |
| `space-100` | 8 | Base gap |
| `space-150` | 12 | Compact padding |
| `space-200` | 16 | Default component padding |
| `space-250` | 20 | Button/input horizontal padding |
| `space-300` | 24 | Card padding |
| `space-400` | 32 | Section gap |
| `space-500` | 40 | Large section gap |
| `space-600` | 48 | Page rhythm |
| `space-800` | 64 | Hero/major page gap |
| `space-1000` | 80 | Large layout gap |

## Radius scale

| Token | Value | Use |
|---|---:|---|
| `radius-xs` | 2px | Focus inset, tiny badges |
| `radius-sm` | 4px | Badges, code pills |
| `radius-md` | 8px | Inputs, small cards |
| `radius-lg` | 12px | Buttons, list rows |
| `radius-xl` | 16px | Cards, panels |
| `radius-2xl` | 24px | Modals, app icon masks |
| `radius-pill` | 999px | Pills, switches |

## Elevation scale

| Token | CSS value | Use |
|---|---|---|
| `shadow-1` | `0 1px 4px rgba(0,0,0,.18)` | Subtle raised controls |
| `shadow-2` | `0 4px 12px rgba(0,0,0,.22)` | Cards |
| `shadow-3` | `0 8px 24px rgba(0,0,0,.28)` | Popovers |
| `shadow-4` | `0 16px 40px rgba(0,0,0,.34)` | Drawers, modals |
| `shadow-5` | `0 24px 80px rgba(0,0,0,.42)` | Command palette |

## Component implementation contracts

See `components/component-spec.md` for full component specs.

## Accessibility rules

- All focusable controls must have a visible `:focus-visible` state.
- Target size must be at least 44px for touch surfaces.
- Text contrast must pass WCAG AA. Prefer AAA for body text in dark mode.
- Never use color alone for error or success states. Pair color with icon and text.
- Respect `prefers-reduced-motion`.

## Motion rules

| Token | Value | Use |
|---|---:|---|
| `duration-fast` | 120ms | Hover/press |
| `duration-base` | 180ms | Dropdown/popover |
| `duration-slow` | 260ms | Drawer/modal |
| `duration-slower` | 420ms | Large page transition |
| `ease-standard` | `cubic-bezier(0.2,0,0,1)` | Default |
| `ease-spring` | `cubic-bezier(0.16,1,0.3,1)` | Premium reveal |

## Product screens required

- Chat shell
- New chat blank slate
- Agent builder
- Plugin store
- Knowledge base library
- Knowledge base editor/file upload
- Model/provider settings
- API key vault
- Workflow builder
- Onboarding
- Command palette
- Error/reconnect states

# nexumChat Component Spec

## Shared component rules

- Use semantic CSS variables from `tokens/nexumChat.css`.
- Minimum touch target: 44px.
- Every focusable element needs `:focus-visible` using `--focus-ring`.
- Interactive elements transition on `background`, `border-color`, `box-shadow`, `opacity`, and `transform` only.
- Do not hardcode colors in components.

## Button

### Variants

| Variant | Background | Text | Border | Shadow |
|---|---|---|---|---|
| Primary | `--gradient-brand` | `#FFFFFF` | transparent | `--glow-violet` |
| Secondary | `--color-surface-2` | `--color-text` | `--color-border` | none |
| Ghost | transparent | `--color-text-muted` | transparent | none |
| Destructive | `--color-danger` | `#FFFFFF` | transparent | none |

### Sizes

| Size | Height | Padding X | Radius | Font |
|---|---:|---:|---:|---|
| sm | 32px | 12px | 8px | caption |
| md | 40px | 16px | 12px | small/body-strong |
| lg | 48px | 20px | 14px | body-strong |

### States

- Hover: translateY(-1px), increase border contrast.
- Active: translateY(0), scale(0.99).
- Disabled: opacity 0.5, pointer-events none.
- Loading: replace leading icon with spinner, keep button width stable.

## Input and textarea

- Height: 40px default; 48px large.
- Background: `--color-surface-2`.
- Border: `1px solid --color-border-subtle`.
- Radius: `--radius-lg`.
- Padding: 12px 14px.
- Placeholder: `--color-text-subtle`.
- Focus: `--focus-ring`, border `--color-focus`.
- Error: border `--color-danger`, helper text uses `--color-danger` plus icon.

## Sidebar navigation

### Dimensions

- Expanded width: 280px.
- Collapsed width: 72px.
- Mobile: off-canvas drawer width `min(88vw, 320px)`.

### Nav item

- Height: 40px.
- Radius: 12px.
- Gap: 12px.
- Icon: 20px.
- Default text: `--color-text-muted`.
- Active background: `--color-surface-2` plus left 2px gradient rail.
- Active text: `--color-text`.
- Hover background: `rgba(255,255,255,.04)` in dark mode, `rgba(37,99,235,.06)` in light mode.

## Chat composer

- Container width: max 880px.
- Background: `--color-surface-glass`.
- Radius: 24px.
- Border: `1px solid --color-border-subtle`.
- Shadow: `--shadow-3` plus subtle glow on focus.
- Textarea min-height: 52px; max-height: 220px.
- Action row: model selector, attach, tools, voice, send.
- Send button: 40px square, gradient background, radius 14px.

## Message bubble

### User message

- Align right on desktop, full width on mobile.
- Background: brand soft gradient.
- Border: `1px solid rgba(139,92,246,.28)`.
- Radius: 18px 18px 6px 18px.
- Max width: 72ch.

### Assistant message

- Align left.
- Background: transparent or `--color-surface` for grouped cards.
- Rich content cards use `--color-surface`, `--radius-xl`, `--shadow-1`.
- Code blocks use `--color-bg-subtle`, mono font, radius 12px.

## Model/provider selector

- Trigger height: 32px.
- Menu width: 360px.
- Group by provider: Local, OpenAI, Anthropic, Google, OpenRouter, Custom.
- Each row includes provider icon, model name, context window, capability tags.
- Selected row gets gradient check indicator.

## Agent card

- Card size: responsive, min 260px.
- Avatar: 44px node-ring icon/avatar.
- Header: agent name, status badge.
- Body: description, model/provider, tools count.
- Footer: Run, Edit, More actions.
- Hover: lift 2px, shadow-3, border `--color-primary` at 40% alpha.

## Plugin card

- Icon: 40px.
- Title, verified badge, short description.
- Permissions chips.
- CTA states: Install, Installed, Configure, Disabled.
- Risk banner for plugins requesting filesystem/network permissions.

## Knowledge base item

- Icon: file/database type.
- Title, source count, token/index size, last synced.
- Status badge: Synced, Indexing, Error, Paused.
- Quick actions: Search, Upload, Settings.

## Command palette

- Width: `min(720px, calc(100vw - 32px))`.
- Top offset: 12vh.
- Background: `--color-surface-glass`.
- Backdrop: `--color-scrim`.
- Shadow: `--shadow-5`.
- Input height: 56px; results row 48px.
- Keyboard: ArrowUp/Down, Enter, Escape, Cmd+K.

## Modal and drawer

- Modal radius: 24px.
- Modal max width: 560px default, 880px large.
- Drawer width: 420px default, 520px wide.
- Scrim: `--color-scrim`.
- Close on Escape and outside click unless destructive flow.

## Toast

- Position: top-right desktop, bottom mobile.
- Width: 360px desktop, full minus 24px mobile.
- Radius: 16px.
- Shadow: `--shadow-4`.
- Auto-dismiss: 4s for success/info, manual for errors.

## LobeHub-specific surfaces

### Chat shell

Includes sidebar, conversation list, active chat viewport, composer, model selector, and optional inspector pane.

### Agent builder

Two-column layout on desktop: form/editor left, live preview right. Collapse to stepped single column on mobile.

### Plugin store

Grid layout with filters, search, permission categories, installed status, and plugin details drawer.

### Knowledge base editor

Upload dropzone, source list, parsing status, chunking controls, embedding model selector, and retrieval test console.

### Provider settings

Provider cards, API-key vault, test connection action, default model picker, local model endpoint editor.

### Workflow builder

Canvas plus node palette, inspector drawer, run history, and test prompt panel.

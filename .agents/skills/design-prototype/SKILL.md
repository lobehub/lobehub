---
name: design-prototype
description: 'Use for interactive HTML prototypes (交互原型) with the real LobeHub UI stack. Excludes production UI implementation.'
---

# Design Prototype

One HTML file, double-click to open, fully interactive, rendered by the **actual
design system** (`@lobehub/ui` 6.x components, compiled `style.css`, `--lobe-*` theme tokens — exact
versions from this repo's `node_modules`) — while the source stays **production-style
React** (`import { Block } from '@lobehub/ui'`, `createStaticStyles(({ css, cssVar }) => …)`,
hooks, `memo`). Promotion to production is mostly "split into files", not "rewrite".

Prototype code may be quick-and-dirty (one file, no i18n, inline data) — but the
**interaction must be complete**: states, transitions, and affordances are the point
of a prototype, not its code style.

## How it works

```
one-time (~2s, cached):   scripts/build-runtime.sh  →  lobe-prototype-runtime.js (IIFE global)
                                                       + lobe-prototype-runtime.css
                                                       + vendored babel.min.js
per prototype (no build): single HTML  =  <link css> + <script runtime> + babel-standalone
                          + <script type="text/babel"> with production-style React
```

- The runtime bundles `react`, `react-dom/client`, the full `@lobehub/ui` namespace,
  `lucide-react` and `motion` from the repo's own `node_modules` — so tokens/components/
  versions match production, and react/emotion/theme-scope are singletons by
  construction.
- `entry.mjs` also imports `@lobehub/ui/theme.css` + `global.css` + `style.css` (the same
  three the app loads in `src/layout/GlobalProvider/AppTheme.tsx`); esbuild emits them
  as `lobe-prototype-runtime.css`, linked from the template's `<head>`.
- A 3-line `window.require` shim + babel's `transform-modules-commonjs` lets the
  prototype keep real `import` statements.
- Theming is CSS attributes, not a provider: the template's head script calls
  `setLobeTheme({ appearance })` from `prefers-color-scheme` (and on change), so
  light/dark follow the OS before first paint. Force a theme with
  `setLobeTheme({ appearance: 'dark' })`, or `<ThemeScope appearance="dark">` for an
  island. The React tree is wrapped in `<ConfigProvider motion={motion}>` like the app's
  `AppTheme` (motion for `Button`, `Drawer`, `Modal`, …, plus fonts, focus ring and the
  popup portal host) and `<ToastHost />` for `toast`.

> ⚠️ Don't re-attempt the pure-CDN route (esm.sh import maps). It was tried and
> rejected: esm.sh's CJS named-export analysis failed serially across the dep chain and
> `?bundle` leaked an unversioned `react-is` 404. Bundling from the repo's own
> `node_modules` is the only way to match production versions exactly.

## Quickstart

1. **Build the runtime into the prototype's directory** (any dir works; `/tmp` is fine):

   ```bash
   bash .agents/skills/design-prototype/scripts/build-runtime.sh /tmp/my-proto
   ```

   Skip if `lobe-prototype-runtime.{js,css}` + `babel.min.js` are already there and the
   design-system versions haven't bumped. The first run downloads `babel.min.js` from
   unpkg (pinned); later runs reuse it.

2. **Copy [`references/template.html`](references/template.html)** into the same dir,
   rename, and replace the sample `App` with the real surface. Keep the runtime shim
   block untouched.

3. **Open it** (`open /tmp/my-proto/xxx.html`) — no server, no build.

## Verify before delivering

Headless-check it renders with zero console errors (the repo's e2e Playwright works):

```js
// node /tmp/check.mjs   — adjust paths
import { chromium } from '<repo>/e2e/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('file:///tmp/my-proto/xxx.html');
await p.waitForSelector('#root *', { timeout: 30000 });
await p.screenshot({ path: '/tmp/proto.png' }); // Read the screenshot yourself
console.log('errors:', errs);
await b.close();
```

Then **Read the screenshot** — a prototype is a visual deliverable; don't ship it
sight-unseen. Check light + dark (emulate `prefers-color-scheme`) and a narrow
viewport if the surface has a mobile story.

## What's in the runtime (extend freely)

See [`assets/entry.mjs`](assets/entry.mjs) — the single source of truth. Currently:

- `@lobehub/ui`: full namespace — every component (`Button`, `Input`, `Modal`,
  `createModal`, `confirmModal`, `Table`, `Switch`, `Checkbox`, `Radio`, `Badge`,
  `Progress`, `Slider`, `Steps`, `Divider`, `DropdownMenu`, `Accordion`, `Collapsible`,
  `Spin`, `Skeleton`, `DraggablePanel`, `FloatingSheet`, …) plus `toast` / `ToastHost`,
  `MotionProvider`, `setLobeTheme`, `ThemeScope`, `useThemeMode`, `useTheme`, and the
  styling API `createStaticStyles`, `cssVar`, `cx`, `css`, `keyframes`, `responsive`,
  `useResponsive`
- `@lobehub/icons`: Amp, ClaudeCode, Codex, HermesAgent, OpenClaw, OpenCode
- `lucide-react`, `motion/react`, `motion/react-m`, `react`, `react/jsx-runtime`,
  `react-dom`, `react-dom/client`: full namespaces

Not included: `@lobehub/ui/form`, `@lobehub/ui/pro-table`, `@lobehub/ui/chat` and the
other subpaths — add `import * as x from '@lobehub/ui/<sub>'` + a `'@lobehub/ui/<sub>': x`
entry and rebuild (\~2s). Size ≈ 17MB JS + 0.3MB CSS (fine from disk).

### Picking the v6 equivalent

- Feedback: `toast.success(…)` + `<ToastHost />`; dialogs: `Modal`, `createModal`,
  `confirmModal`.
- Menus: `DropdownMenu items={…}` (opens on click); context menus: `ContextMenuTrigger`.
- Layout: `Flexbox horizontal gap={…}` / `Center` / `Grid` — there is no `Space`.
- Disclosure: `Accordion` for several sections, `Collapsible` for one region.
- `Badge`, `Checkbox`, `Divider`, `Progress`, `Radio`, `Slider`, `Steps`, `Switch`,
  `Table` (`columns` / `dataSource` / `rowSelection`) are root exports.
- Unsure about a name → check `node_modules/@lobehub/ui/es/index.d.mts` rather than
  guessing; an unknown import is `undefined` at runtime, not a build error.

## Pitfalls

- **Style with `createStaticStyles` + `cssVar.*`** exactly as production does — it is
  emotion-backed and inserts at call time, so it needs no build step. Tokens resolve
  to `var(--lobe-*)` and flip with the theme; never hardcode light/dark colors.
- **Component styles live in cascade layers** (`lobe-base`, `lobe-popup`, `lobe-ui`), so
  any unlayered CSS in the prototype's `<style>` beats them. Override through
  `className` / `style` / `classNames` / `styles` slot props, not global selectors
  like `button { … }`.
- **Keep the `<link>` to `lobe-prototype-runtime.css`** — without it components render
  unstyled and `--lobe-*` tokens are undefined.
- **babel must stay the raw UMD file** (unpkg/jsdelivr). esm.sh rewrites it to ESM
  and a classic `<script src>` chokes on `export`.
- The require shim throws with the module name when an import isn't in the runtime —
  that's the "add to entry.mjs and rebuild" signal, not a template bug.
- `Text type` accepts only `secondary|success|warning|danger|info`; `Tag color` has
  no `primary` (DESIGN.md "Applying tokens in components").

## Design bar (same as production surfaces)

A prototype is a surface — the [ux](../ux/SKILL.md) checklists apply to what it
_demonstrates_:

- Show **at least one non-happy-path state** (empty / loading / error / in-progress),
  ideally behind a state-toggle strip like the template's. A happy-path-only
  prototype under-specifies the design and silently blesses missing states.
- Reuse the app's **surface contracts**: side panels are `DraggablePanel`
  (collapse + drag-resize come free), loading follows the ux skill's feedback §4.1
  scenario table (`Skeleton` / `Spin`, `variant="network"` only for AI work), modals via `createModal`-style flows.
- Don't paint affordances you don't wire (`cursor: zoom-in` with no zoom, keycap
  chips with no keys) — in an _interactive_ prototype a dead affordance is a spec bug.
- Walk the ux Quick review against the prototype before delivering; annotate
  anything deliberately out of scope in an HTML comment so the implementer knows
  it's a cut, not a decision.

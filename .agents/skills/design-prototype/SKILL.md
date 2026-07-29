---
name: design-prototype
description: Produce an interactive single-file HTML design prototype using the REAL LobeHub design system (@lobehub/ui + antd + antd-style tokens) with production-style React — no build step, opens directly in a browser. Use when asked for a design prototype / interactive mockup / 交互原型 / 出个原型 / 设计稿 HTML for a page or flow, or to explore a redesign before committing to implementation.
---

# Design Prototype

One HTML file, double-click to open, fully interactive, rendered by the **actual
design system** (`@lobehub/ui` 5.x + antd 6 + antd-style tokens, exact versions from
this repo's `node_modules`) — while the source stays **production-style React**
(`import { Block } from '@lobehub/ui'`, `createStyles(({ css, token }) => …)`, hooks,
`memo`). Promotion to production is mostly "split into files", not "rewrite".

Prototype code may be quick-and-dirty (one file, no i18n, inline data) — but the
**interaction must be complete**: states, transitions, and affordances are the point
of a prototype, not its code style.

## How it works

```
one-time (~2s, cached):   scripts/build-runtime.sh  →  lobe-prototype-runtime.js (IIFE global)
                                                       + vendored babel.min.js
per prototype (no build): single HTML  =  <script runtime> + babel-standalone
                          + <script type="text/babel"> with production-style React
```

- The runtime bundles `react`, `react-dom/client`, `@lobehub/ui`, `@lobehub/ui/base-ui`,
  `antd` (curated subset), `antd-style`, `lucide-react` from the repo's own
  `node_modules` — so tokens/components/versions match production, and react/emotion/
  theme-context are singletons by construction.
- A 3-line `window.require` shim + babel's `transform-modules-commonjs` lets the
  prototype keep real `import` statements.
- `ThemeProvider themeMode="auto"` → light/dark follow the OS.

> ⚠️ Don't re-attempt the pure-CDN route (esm.sh import maps). It was tried and
> rejected: esm.sh's CJS named-export analysis fails serially across antd's dep chain
> (`@ant-design/fast-color` → `@ant-design/colors` → `@rc-component/qrcode` → …), and
> `?bundle` leaks an unversioned `react-is` 404. Whack-a-mole, not a foundation.

## Quickstart

1. **Build the runtime into the prototype's directory** (any dir works; `/tmp` is fine):

   ```bash
   bash .agents/skills/design-prototype/scripts/build-runtime.sh /tmp/my-proto
   ```

   Skip if `lobe-prototype-runtime.js` + `babel.min.js` are already there and the
   design-system versions haven't bumped.

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

- `@lobehub/ui`: ActionIcon, Alert, Avatar, Block, Button, Center, Collapse,
  DraggablePanel, Drawer, DropdownMenu, Empty, Flexbox, Highlighter, Hotkey, Icon,
  Image, Input, InputNumber, Markdown, Modal, NeuralNetworkLoading, Popover,
  ScrollShadow, SearchBar, Segmented, Select, Skeleton, SortableList, Tabs, Tag,
  Text, TextArea, ThemeProvider, Tooltip
- `@lobehub/ui/base-ui`: full namespace (Select, Modal, DropdownMenu, Switch, Toast,
  FloatingSheet, …)
- `antd`: App, Badge, Checkbox, Divider, Dropdown, Progress, Radio, Slider, Space,
  Steps, Table
- `antd-style`, `lucide-react`, `react`, `react-dom/client`: full namespaces

Missing a component → add to `entry.mjs`, rerun the build script (\~2s). Sizes:
curated ≈ 16MB (fine from disk); a full `export * from '@lobehub/ui'` works too
(≈ 27MB) if you'd rather never curate.

## Pitfalls

- **`Switch` lives in `@lobehub/ui/base-ui`**, not the root package (as do the other
  base-ui primitives). Importing it from the root fails the runtime build.
- **Use `createStyles` (runtime), not `createStaticStyles`** — static extraction
  needs a build step. This is the one sanctioned deviation from production style;
  note it when handing the prototype to an implementer.
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
  (collapse + drag-resize come free), loading is skeleton/`NeuralNetworkLoading`
  (never antd `Spin`), modals via `createModal`-style flows.
- Don't paint affordances you don't wire (`cursor: zoom-in` with no zoom, keycap
  chips with no keys) — in an _interactive_ prototype a dead affordance is a spec bug.
- Walk the ux Quick review against the prototype before delivering; annotate
  anything deliberately out of scope in an HTML comment so the implementer knows
  it's a cut, not a decision.

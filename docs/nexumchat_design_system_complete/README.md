# nexumChat Design System Complete Import Pack

This archive converts the nexumChat brand direction into an implementation-ready design system for a LobeHub/LobeChat-style AI chat interface.

Brand spelling rule: **always use `nexumChat`** exactly: lowercase `nexum`, uppercase `C`, no spaces.

## What's included

- `tokens/tokens.json` — source-of-truth tokens for colors, spacing, radius, typography, opacity, elevation, motion and z-index.
- `tokens/nexumChat.css` — CSS custom properties and base utility styles.
- `tokens/tailwind.config.cjs` — Tailwind theme mapping.
- `components/component-spec.md` — implementation specs for base components and LobeHub-specific product surfaces.
- `wireframes/*.md` — rough branded wireframes for the main screens.
- `docs/design-system-spec.md` — cleaned implementation spec with exact values and no citation artifacts.
- `examples/chat-shell.html` — static HTML/CSS example showing the visual direction.

## Recommended import order

1. Import or copy `tokens/tokens.json` into your design-token pipeline.
2. Add `tokens/nexumChat.css` to the app global stylesheet.
3. Merge `tokens/tailwind.config.cjs` into the app Tailwind config if Tailwind is used.
4. Use `components/component-spec.md` as the component contract.
5. Use the wireframes as implementation targets for LobeHub-specific pages.

## Non-negotiables

- Preserve the casing `nexumChat` in all user-visible text.
- Use semantic tokens instead of raw colors in components.
- Dark mode is the primary brand experience; light mode must still be fully supported.
- Accessibility target is WCAG AA minimum.
- Reduced motion must be respected.

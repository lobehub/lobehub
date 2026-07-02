---
version: alpha
name: LobeHub (Dark)
description: LobeHub's design system — Dark theme. Same semantic token names as the Light theme (DESIGN.md) with dark values. Tokens are themeable (cssVar key `lobe-vars`); components must read the semantic tokens, never hard-code hex. Only colors change between themes — typography, spacing, radius, controls, motion, shapes, components, voice, and the design values are identical to DESIGN.md.
themeable:
  primaryColor:
    default: ~ # monochrome (near-white in dark) when unset — see colorPrimary
    options:
      [red, orange, gold, yellow, lime, green, cyan, blue, geekblue, purple, magenta, volcano]
  neutralColor:
    default: ~ # the built-in `gray` scale when unset
    options: [mauve, slate, sage, olive, sand]
colors:
  # Semantic tokens (lobe-ui token names). Dark-theme defaults shown.
  colorPrimary: '#eeeeee' # monochrome by default; becomes the chosen primaryColor[9]
  colorSuccess: '#c4f042' # lime (dark uses a brighter hue than light's green)
  colorWarning: '#ffb224' # gold
  colorError: '#f4416c' # red (dark uses red; light uses volcano)
  colorInfo: '#60b1ff' # blue (dark uses blue; light uses geekblue)
  # Text — solid neutrals from the `gray` scale; rank info with these
  colorText: '#ffffff' # primary text and icons
  colorTextSecondary: '#aaaaaa' # secondary text, labels
  colorTextTertiary: '#6f6f6f' # placeholder, captions
  colorTextQuaternary: '#555555' # disabled
  # Surfaces — separate scale from text; never substitute one for the other
  colorBgLayout: '#000000' # page background (darkest)
  colorBgContainer: '#0d0d0d' # primary card / panel surface
  colorBgContainerSecondary: '#070707' # subtle secondary surface (lobe-ui custom token)
  colorBgElevated: '#1a1a1a' # popovers, menus, modals (lifts as it rises)
  colorBgSpotlight: '#2d2d2d' # tooltips
  # Borders & fills — translucent, layer over any background
  colorBorder: '#202020' # stronger edge
  colorBorderSecondary: '#1a1a1a' # default divider / subtle border
  colorFill: 'rgba(255, 255, 255, 0.16)'
  colorFillSecondary: 'rgba(255, 255, 255, 0.1)'
  colorFillTertiary: 'rgba(255, 255, 255, 0.06)' # hover wash
  colorFillQuaternary: 'rgba(255, 255, 255, 0.02)' # active wash
elevation:
  # Identical to the Light theme — shadows are shared, only surfaces change
  boxShadowTertiary: '0 3px 1px -1px rgba(26, 26, 26, 0.06)' # raised cards
  boxShadowSecondary: '0 8px 16px -4px rgba(0, 0, 0, 0.2)' # popovers, menus
  boxShadow: '0 20px 20px -8px rgba(0, 0, 0, 0.24)' # modals, dialogs
typography:
  # Identical to DESIGN.md (theme-independent)
  fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, "HarmonyOS Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif'
  fontFamilyCode: '"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Code", Consolas, "HarmonyOS Sans SC", monospace'
  fontSizeSM: 12
  fontSize: 14
  fontSizeLG: 16
  fontSizeXL: 20
  lineHeight: 1.5714
  lineHeightSM: 1.6667
  fontSizeHeading1: 38
  fontSizeHeading2: 30
  fontSizeHeading3: 24
  fontSizeHeading4: 20
  fontSizeHeading5: 16
  fontWeightStrong: 600
spacing:
  XXS: 4
  XS: 8
  SM: 12
  base: 16
  MD: 20
  LG: 24
  XL: 32
radius:
  borderRadiusXS: 4
  borderRadiusSM: 6
  borderRadius: 8
  borderRadiusLG: 12
controls:
  controlHeightSM: 28
  controlHeight: 36
  controlHeightLG: 40
---

# LobeHub (Dark)

This is the **Dark theme** of LobeHub's design system. It is the companion to **[DESIGN.md](./DESIGN.md)** (Light) and shares everything but color: the same semantic token _names_, the same typography, spacing, radius, control, motion, shape, component, and voice rules, and the same four design values (Natural · Meaningful · Certainty · Growth).

Read this file for the **dark color values**; read [DESIGN.md](./DESIGN.md) for all the guidance prose, which is theme-independent. As always: consume semantic tokens by name (`cssVar.colorText`, `cssVar.colorBgContainer`, …) so components follow the user's theme automatically — never hard-code the hex values below.

## Colors

Dark uses the same semantic-token model as Light, with the values inverted around a near-black canvas. A few things specific to dark:

- **Surfaces lift as they rise.** The page canvas `colorBgLayout` is pure black (`#000000`); `colorBgContainer` (`#0d0d0d`) sits above it, and `colorBgElevated` (`#1a1a1a`) is lighter still for popovers, menus, and modals. Depth reads through getting _lighter_, the opposite of light theme. Keep `colorBgLayout` and `colorBgContainer` distinct — don't flatten the stack.
- **Text is solid `gray`-scale neutrals**, not translucent: `colorText` `#ffffff` → `colorTextSecondary` `#aaaaaa` → `colorTextTertiary` `#6f6f6f` → `colorTextQuaternary` `#555555` (disabled). Rank information with this ramp rather than with color.
- **Borders and fills stay translucent white** (`colorFill*`, `rgba(255,255,255,…)`), so they layer correctly over any dark surface. Use `colorBorderSecondary` for the everyday divider and `colorBorder` for a stronger edge.
- **`colorPrimary` is monochrome by default** — near-white (`#eeeeee`) in dark — and only takes on a hue when the user picks a primary color, keeping the default UI calm.
- **Functional hues shift for dark legibility.** Dark draws `colorError` from `red` and `colorInfo` from `blue` (Light uses `volcano` and `geekblue`), and `colorSuccess` brightens to `lime`. This is intentional — read the token, not a fixed hue.

For elevation, motion, shapes, components, typography, layout, voice, and the do's and don'ts, see **[DESIGN.md](./DESIGN.md)** — they apply unchanged in dark.

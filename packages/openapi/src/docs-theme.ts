/**
 * Scalar theme overrides matching the main app's look: LobeHub's neutral
 * monochrome palette (black accent on light, white accent on true-black dark)
 * and the antd system font stack. Applied on top of Scalar's default theme
 * via `customCss` in `app.ts`.
 */
export const SCALAR_CUSTOM_CSS = `
:root {
  --scalar-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  --scalar-font-code: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo,
    Courier, monospace;
  --scalar-radius: 6px;
  --scalar-radius-lg: 8px;
  --scalar-radius-xl: 10px;
}

.light-mode {
  --scalar-background-1: #ffffff;
  --scalar-background-2: #fafafa;
  --scalar-background-3: #f5f5f5;
  --scalar-background-accent: rgba(0, 0, 0, 0.04);
  --scalar-border-color: rgba(5, 5, 5, 0.08);
  --scalar-color-1: rgba(0, 0, 0, 0.88);
  --scalar-color-2: rgba(0, 0, 0, 0.65);
  --scalar-color-3: rgba(0, 0, 0, 0.45);
  --scalar-color-accent: #000000;
  --scalar-sidebar-background-1: #fafafa;
  --scalar-sidebar-border-color: rgba(5, 5, 5, 0.08);
  --scalar-sidebar-color-active: rgba(0, 0, 0, 0.88);
  --scalar-sidebar-item-active-background: rgba(0, 0, 0, 0.06);
  --scalar-sidebar-item-hover-background: rgba(0, 0, 0, 0.04);
}

.dark-mode {
  --scalar-background-1: #000000;
  --scalar-background-2: #0a0a0a;
  --scalar-background-3: #141414;
  --scalar-background-accent: rgba(255, 255, 255, 0.06);
  --scalar-border-color: rgba(255, 255, 255, 0.1);
  --scalar-color-1: rgba(255, 255, 255, 0.9);
  --scalar-color-2: rgba(255, 255, 255, 0.65);
  --scalar-color-3: rgba(255, 255, 255, 0.45);
  --scalar-color-accent: #ffffff;
  --scalar-sidebar-background-1: #0a0a0a;
  --scalar-sidebar-border-color: rgba(255, 255, 255, 0.1);
  --scalar-sidebar-color-active: rgba(255, 255, 255, 0.9);
  --scalar-sidebar-item-active-background: rgba(255, 255, 255, 0.1);
  --scalar-sidebar-item-hover-background: rgba(255, 255, 255, 0.06);
}
`;

import type { InterfaceDensity } from '@lobechat/types';

/**
 * Interface density scale — the single hand-written source of truth.
 *
 * StyleX only accepts literals in `defineVars` / `createTheme`, so the values
 * cannot be read from JS at compile time. Instead the px numbers live here once
 * and everything else is derived from this file:
 *
 * - `scripts/densityTokens.mts` generates `density.stylex.ts` (StyleX vars, Loose
 *   defaults) and `densityTheme.ts` (Compact overrides). Run `pnpm gen:density`.
 * - `density.ts` derives `DENSITY_TOKENS`, the numeric scale used for component
 *   props, including composed values such as `headerActionSize`.
 *
 * Every key also becomes a `--lobe-density-<kebab-case>` CSS variable, so
 * stylesheets read the same number instead of keeping a second token table.
 * Editing a value only ever happens here.
 */
export interface DensityScale {
  controlHeight: number;
  fontSize: number;
  gap: number;
  headerAvatarSize: number;
  headerHeight: number;
  headerIconSize: number;
  headerSmallIconSize: number;
  iconBox: number;
  iconSize: number;
  lineHeight: number;
  listRowHeight: number;
  paddingInline: number;
  pageTitleFontSize: number;
  panelPaddingInline: number;
  radius: number;
  rowHeight: number;
  sectionGap: number;
  toolbarHeight: number;
}

export const DENSITY_SCALE: Record<InterfaceDensity, DensityScale> = {
  compact: {
    controlHeight: 28,
    fontSize: 13,
    gap: 8,
    headerAvatarSize: 24,
    headerHeight: 40,
    headerIconSize: 16,
    headerSmallIconSize: 14,
    iconBox: 24,
    iconSize: 16,
    lineHeight: 20,
    listRowHeight: 40,
    paddingInline: 4,
    pageTitleFontSize: 14,
    panelPaddingInline: 6,
    radius: 6,
    rowHeight: 32,
    sectionGap: 12,
    toolbarHeight: 36,
  },
  loose: {
    controlHeight: 32,
    fontSize: 14,
    gap: 8,
    headerAvatarSize: 28,
    headerHeight: 44,
    headerIconSize: 20,
    headerSmallIconSize: 16,
    iconBox: 28,
    iconSize: 18,
    lineHeight: 22,
    listRowHeight: 48,
    paddingInline: 4,
    pageTitleFontSize: 16,
    panelPaddingInline: 4,
    radius: 8,
    rowHeight: 36,
    sectionGap: 16,
    toolbarHeight: 40,
  },
};

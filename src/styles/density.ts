import { type InterfaceDensity } from '@lobechat/types';
import { createContext, useContext } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { isMobileSurface } from '@/utils/mobileSurface';

import { DENSITY_SCALE, type DensityScale } from './densityScale';

export interface ActionSize {
  blockSize: number;
  size: number;
}

export interface DensityTokens {
  badgeHeight: number;
  badgeMinWidth: number;
  cardPadding: number;
  contentGap: number;
  controlHeight: number;
  fontSize: number;
  gap: number;
  headerActionSize: ActionSize;
  headerActionSmallSize: ActionSize;
  headerAvatarSize: number;
  headerChevronSize: number;
  headerHeight: number;
  iconBox: number;
  iconSize: number;
  largeIconSize: number;
  lineHeight: number;
  listRowHeight: number;
  modalPadding: number;
  paddingInline: number;
  pagePaddingBlockEnd: number;
  pagePaddingBlockStart: number;
  pagePaddingInline: number;
  pageTitleFontSize: number;
  panelPaddingInline: number;
  radius: number;
  rowHeight: number;
  sectionGap: number;
  sectionHeaderHeight: number;
  toolbarHeight: number;
  treeItemHeight: number;
}

/**
 * Adds the sizes the app composes from the raw scale (action hit areas, section
 * headers, tree rows) so components never re-derive them by hand.
 */
const withDerivedTokens = ({
  headerIconSize,
  headerSmallIconSize,
  ...scale
}: DensityScale): DensityTokens => ({
  ...scale,
  headerActionSize: { blockSize: scale.controlHeight, size: headerIconSize },
  headerActionSmallSize: { blockSize: scale.iconBox, size: headerSmallIconSize },
  headerChevronSize: headerSmallIconSize,
  sectionHeaderHeight: scale.controlHeight,
  treeItemHeight: scale.controlHeight,
});

// The px values live in densityScale.ts. The matching --lobe-density-* CSS variables are
// generated from that file into density.stylex.ts / densityTheme.ts (scripts/densityTokens.mts).
export const DENSITY_TOKENS: Record<InterfaceDensity, DensityTokens> = {
  compact: withDerivedTokens(DENSITY_SCALE.compact),
  loose: withDerivedTokens(DENSITY_SCALE.loose),
};

/**
 * Mobile surfaces always render loose, whatever the stored preference says. Both the
 * stylesheet attribute and the hooks resolve density through here so they cannot drift.
 */
export const resolveEffectiveDensity = (density: InterfaceDensity): InterfaceDensity =>
  isMobileSurface() ? 'loose' : density;

export const useInterfaceDensity = (): InterfaceDensity => {
  const density = useUserStore(userGeneralSettingsSelectors.interfaceDensity);
  return resolveEffectiveDensity(density);
};

export const useDensityTokens = () => DENSITY_TOKENS[useInterfaceDensity()];

/**
 * One density read per component: the numeric scale for props, plus the boolean that
 * picks between structural style variants.
 */
export const useDensity = (): {
  compact: boolean;
  density: InterfaceDensity;
  tokens: DensityTokens;
} => {
  const density = useInterfaceDensity();
  return { compact: density === 'compact', density, tokens: DENSITY_TOKENS[density] };
};

export const PanelDensityContext = createContext<InterfaceDensity | null | undefined>(undefined);

export const usePanelDensityTokens = (): DensityTokens | null => {
  const density = useContext(PanelDensityContext);
  return density ? DENSITY_TOKENS[density] : null;
};

export const useHeaderActionSize = (small?: boolean): ActionSize => {
  const tokens = useDensityTokens();
  return small ? tokens.headerActionSmallSize : tokens.headerActionSize;
};

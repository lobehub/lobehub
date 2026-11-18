import { type InterfaceDensity } from '@lobechat/types';
import { createContext, useContext } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

export interface ActionSize {
  blockSize: number;
  size: number;
}

export interface DensityTokens {
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
  lineHeight: number;
  listRowHeight: number;
  paddingInline: number;
  pageTitleFontSize: number;
  panelPaddingInline: number;
  radius: number;
  rowHeight: number;
  sectionGap: number;
  sectionHeaderHeight: number;
  toolbarHeight: number;
  treeItemHeight: number;
}

type DensityScale = Omit<
  DensityTokens,
  | 'headerActionSize'
  | 'headerActionSmallSize'
  | 'headerChevronSize'
  | 'sectionHeaderHeight'
  | 'treeItemHeight'
> & {
  headerIconSize: number;
  headerSmallIconSize: number;
};

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

// The px values also live in density.stylex.ts and densityTheme.ts as --lobe-density-* CSS
// variables, because StyleX only compiles literals; densityParity.test.ts keeps them in step.
export const DENSITY_TOKENS: Record<InterfaceDensity, DensityTokens> = {
  compact: withDerivedTokens({
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
    pageTitleFontSize: 14,
    paddingInline: 4,
    panelPaddingInline: 6,
    radius: 6,
    rowHeight: 32,
    sectionGap: 12,
    toolbarHeight: 36,
  }),
  loose: withDerivedTokens({
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
    pageTitleFontSize: 16,
    paddingInline: 4,
    panelPaddingInline: 4,
    radius: 8,
    rowHeight: 36,
    sectionGap: 16,
    toolbarHeight: 40,
  }),
};

export const useInterfaceDensity = () =>
  useUserStore(userGeneralSettingsSelectors.interfaceDensity);

export const useDensityTokens = () => DENSITY_TOKENS[useInterfaceDensity()];

export const PanelDensityContext = createContext<InterfaceDensity | null>(null);

export const usePanelDensityTokens = (): DensityTokens | null => {
  const density = useContext(PanelDensityContext);
  return density ? DENSITY_TOKENS[density] : null;
};

export const useHeaderActionSize = (small?: boolean): ActionSize => {
  const tokens = useDensityTokens();
  return small ? tokens.headerActionSmallSize : tokens.headerActionSize;
};

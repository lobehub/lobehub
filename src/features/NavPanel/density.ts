import { type InterfaceDensity } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';
import { useContext } from 'react';

import { DENSITY_TOKENS, PanelDensityContext, useInterfaceDensity } from '@/styles/density';

export interface NavItemMetrics {
  fontSize: number;
  gap: number;
  headerAvatarSize: number;
  headerChevronSize: { blockSize: number; size: number };
  headerLabelFontSize: number;
  headerLabelWeight: number;
  headerTitleFontSize: number;
  headerTitleWeight: number;
  iconBox: number;
  iconSize: number;
  lineHeight: number;
  paddingInline: number;
  panelPaddingInline: number;
  radius?: number;
  rowHeight: number;
  sectionGap: number;
  sectionLabelColor: string;
  sectionTriggerPaddingBlock: number;
  sectionTriggerPaddingInline: string;
  twoLineGap: number;
  twoLinePaddingBlock: number;
}

const SECTION_ACTION_SIZE = 24;

export const resolveNavItemMetrics = (density: InterfaceDensity | null): NavItemMetrics => {
  const tokens = DENSITY_TOKENS[density ?? 'loose'];
  const compact = density === 'compact';

  return {
    fontSize: tokens.fontSize,
    gap: tokens.gap,
    headerAvatarSize: tokens.headerAvatarSize,
    headerChevronSize: { blockSize: tokens.headerChevronSize + 6, size: tokens.headerChevronSize },
    headerLabelFontSize: compact ? 13 : 14,
    headerLabelWeight: compact ? 600 : 500,
    headerTitleFontSize: compact ? 14 : 16,
    headerTitleWeight: compact ? 600 : 500,
    iconBox: tokens.iconBox,
    iconSize: tokens.iconSize,
    lineHeight: tokens.lineHeight,
    paddingInline: tokens.paddingInline,
    panelPaddingInline: tokens.panelPaddingInline,
    radius: density ? tokens.radius : undefined,
    rowHeight: tokens.rowHeight,
    sectionGap: tokens.sectionGap,
    sectionLabelColor: compact ? cssVar.colorTextTertiary : cssVar.colorTextSecondary,
    sectionTriggerPaddingBlock: (tokens.sectionHeaderHeight - SECTION_ACTION_SIZE) / 2,
    sectionTriggerPaddingInline: compact ? '6px 4px' : '8px 4px',
    twoLineGap: compact ? 2 : 3,
    twoLinePaddingBlock: compact ? 6 : 8,
  };
};

export const NavPanelDensityContext = PanelDensityContext;

export const useNavItemMetrics = (): NavItemMetrics => {
  const contextDensity = useContext(NavPanelDensityContext);
  const interfaceDensity = useInterfaceDensity();
  return resolveNavItemMetrics(contextDensity === undefined ? interfaceDensity : contextDensity);
};

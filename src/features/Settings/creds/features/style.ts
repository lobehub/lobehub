import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { densityTokens } from '@/styles/density.stylex';

export const styles = stylex.create({
  // The personal vault's filled card row; listed after `container` so its
  // padding wins.
  card: {
    paddingBlock: '12px',
    paddingInline: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  cardClickable: {
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
  },
  container: {
    paddingBlock: densityTokens['--lobe-density-content-gap'],
    paddingInline: 0,
  },
  // Compact density: 6px block padding, 36px tile, 14px title → ~55px two-line rows.
  containerCompact: {
    paddingBlock: '6px',
  },
  description: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  icon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  iconCompact: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
  },
  key: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  title: {
    fontSize: '15px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
  titleCompact: {
    fontSize: '14px',
  },
});

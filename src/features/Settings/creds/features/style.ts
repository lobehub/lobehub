import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { densityTokens } from '@/styles/density.stylex';

export const styles = stylex.create({
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
  descriptionCompact: { lineHeight: '18px' },
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
  title: {
    overflow: 'hidden',
    fontSize: '15px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  titleCompact: {
    fontSize: '14px',
  },
});

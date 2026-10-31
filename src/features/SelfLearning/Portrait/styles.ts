import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { rowMarker } from './markers.stylex';

/**
 * 整页只有一种强调色，只标一件事：它做错的地方。
 * 「对 / 已养成 / 用上了」是默认态，不发信号；成长曲线用 success 色，和错点分开。
 */
export const portraitStyles = stylex.create({
  accent: {
    color: cssVar.colorWarning,
  },
  bar: {
    overflow: 'hidden',
    display: 'flex',
    width: '100%',
    height: '5px',
    borderRadius: '3px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  profileCounts: {
    minWidth: '0',
    textAlign: { 'default': 'end', '@media (width <= 1100px)': 'start' },
    whiteSpace: 'nowrap',
    gridColumnStart: { 'default': null, '@media (width <= 1100px)': '2' },
    gridColumnEnd: { 'default': null, '@media (width <= 1100px)': '-1' },
  },
  profileKey: {
    flex: 'none',
    width: '32px',
    fontFamily: cssVar.fontFamilyCode,
    whiteSpace: 'nowrap',
  },
  profileProgress: {
    width: '100%',
    minWidth: '120px',
  },
  profileRow: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'minmax(220px, 1.15fr) minmax(180px, 1fr) 84px minmax(220px, auto)',
      '@media (width <= 1100px)': 'minmax(200px, 1fr) minmax(140px, 1fr) 84px',
    },
    gap: '20px',
    alignItems: 'center',
    paddingBlock: '14px',
    paddingInline: '18px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  profileTitle: {
    paddingBlockStart: '14px',
    paddingBlockEnd: '10px',
    paddingInline: '18px',
    fontSize: '12px',
  },
  dot: {
    display: 'inline-block',
    boxSizing: 'border-box',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
  },
  dotBad: {
    backgroundColor: cssVar.colorWarning,
    backgroundImage: 'none',
  },
  dotNone: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  dotOk: {
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
  groupHead: {
    paddingBlock: '8px',
    paddingInline: '14px',
    borderWidth: 0,
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    font: 'inherit',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  previewTarget: {
    cursor: 'pointer',
    textAlign: 'start',
    borderRadius: { 'default': null, ':focus-visible': '4px' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  viewAll: {
    fontSize: '12.5px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
  },
  row: {
    paddingBlock: '10px',
    paddingInline: '14px',
    borderWidth: 0,
    borderBlockEndWidth: { 'default': '1px', ':last-child': null },
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    font: 'inherit',
    backgroundColor: {
      'default': null,
      ':hover': cssVar.colorFillQuaternary,
      ':focus-within': cssVar.colorFillQuaternary,
    },
    backgroundImage: { 'default': null, ':hover': 'none', ':focus-within': 'none' },
  },
  // The teach button shows while its row (rowMarker) is hovered or holds focus.
  teach: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', rowMarker)]: 1,
      [stylex.when.ancestor(':focus-within', rowMarker)]: 1,
    },
    transition: 'opacity 0.15s',
  },
  segBad: {
    backgroundColor: cssVar.colorWarning,
    backgroundImage: 'none',
  },
  segOk: {
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
  segShaky: {
    opacity: 0.55,
    backgroundColor: cssVar.colorWarning,
    backgroundImage: 'none',
  },
  sentence: {
    fontSize: '22px',
    fontWeight: 700,
    lineHeight: 1.4,
    textWrap: 'balance',
  },
});

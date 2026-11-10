import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { mailRowMarker } from './markers.stylex';

const progressSlide = stylex.keyframes({
  from: { transform: 'translateX(-100%)' },
  to: { transform: 'translateX(300%)' },
});

export const mailListStyles = stylex.create({
  actions: {
    position: 'absolute',
    insetBlockStart: '6px',
    insetInlineEnd: '8px',
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    paddingInline: '2px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    boxShadow: cssVar.boxShadowTertiary,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', mailRowMarker)]: 1,
      [stylex.when.ancestor(':has(:focus-visible)', mailRowMarker)]: 1,
    },
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover', mailRowMarker)]: 'auto',
      [stylex.when.ancestor(':has(:focus-visible)', mailRowMarker)]: 'auto',
    },
  },
  actionsAlways: {
    opacity: 1,
    pointerEvents: 'auto',
  },
  bulkBar: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    minHeight: '36px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillTertiary,
  },
  checkbox: {
    position: 'absolute',
    insetBlockStart: '11px',
    insetInlineStart: '10px',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', mailRowMarker)]: 1,
      [stylex.when.ancestor(':has(:focus-visible)', mailRowMarker)]: 1,
    },
  },
  checkboxAlways: {
    opacity: 1,
  },
  dot: {
    position: 'absolute',
    insetBlockStart: '15px',
    insetInlineStart: '13px',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorPrimary,
  },
  list: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
  },
  progress: {
    position: 'absolute',
    insetBlockEnd: 0,
    insetInline: 0,
    overflow: 'hidden',
    height: '2px',
  },
  progressBar: {
    width: '33%',
    height: '100%',
    backgroundColor: cssVar.colorPrimary,
    animationName: progressSlide,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  row: {
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
    paddingBlock: '10px',
    paddingInlineStart: '32px',
    paddingInlineEnd: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
  },
  rowActive: {
    backgroundColor: {
      'default': cssVar.colorFillSecondary,
      ':hover': cssVar.colorFillSecondary,
    },
  },
  searchBox: {
    position: 'relative',
    flexShrink: 0,
  },
  starred: {
    flexShrink: 0,
    color: cssVar.colorWarning,
  },
  tab: {
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    color: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
    },
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
  },
  tabActive: {
    fontWeight: 500,
    color: {
      'default': cssVar.colorText,
      ':hover': cssVar.colorText,
    },
    backgroundColor: {
      'default': cssVar.colorFillSecondary,
      ':hover': cssVar.colorFillSecondary,
    },
  },
  tabCount: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  tabs: {
    scrollbarWidth: 'none',
    overflowX: 'auto',
    display: 'flex',
    flex: '1',
    gap: '2px',
    minWidth: 0,
  },
});

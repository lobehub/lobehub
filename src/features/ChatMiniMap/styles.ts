import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const minimapStyles = stylex.create({
  container: {
    alignItems: 'end',
    display: 'flex',
    flexDirection: 'column',
    insetBlockEnd: '120px',
    insetBlockStart: '16px',
    insetInlineEnd: '8px',
    justifyContent: 'center',
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 1,
  },
  hoverArea: {
    alignItems: 'end',
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
    position: 'relative',
  },
  previewPanel: {
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow:
      '0 6px 16px 0 rgb(0 0 0 / 8%), 0 3px 6px -4px rgb(0 0 0 / 12%), 0 9px 28px 8px rgb(0 0 0 / 5%)',
    display: 'flex',
    insetBlockStart: '50%',
    insetInlineEnd: 0,
    maxWidth: '360px',
    minWidth: '240px',
    opacity: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
    transform: 'translateY(-50%) scale(0.96)',
    transformOrigin: '100% 50%',
    transition: `opacity ${cssVar.motionDurationMid} ease, transform ${cssVar.motionDurationMid} ease`,
  },
  previewPanelVisible: {
    opacity: 1,
    pointerEvents: 'auto',
    transform: 'translateY(-50%) scale(1)',
  },
  rail: {
    'alignItems': 'end',
    'display': 'flex',
    'flexDirection': 'column',
    'gap': 0,
    'maxHeight': '50vh',
    'overflowY': 'auto',
    'scrollbarWidth': 'none',
    'transition': `opacity ${cssVar.motionDurationMid} ease`,
    '::-webkit-scrollbar': {
      display: 'none',
    },
  },
  railFaded: {
    opacity: 0,
    pointerEvents: 'none',
  },
});

export const indicatorStyles = stylex.create({
  indicator: {
    cursor: 'pointer',
    flexShrink: 0,
    height: '12px',
    minWidth: '5px',
    paddingBlock: '5px',
  },
  indicatorContent: {
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
    borderRadius: '2px',
    height: '100%',
    width: '100%',
  },
  indicatorContentActive: {
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
});

export const previewStyles = stylex.create({
  dash: {
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
    borderRadius: '2px',
    flexShrink: 0,
    height: '2px',
  },
  dashActive: {
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
  item: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    borderRadius: '6px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    paddingBlock: '6px',
    paddingInline: '12px',
    transition: `background-color ${cssVar.motionDurationFast} ease`,
  },
  // Hover still wins over the active colour, as it did with the original cascade.
  itemActive: {
    color: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorText },
  },
  label: {
    display: '-webkit-box',
    fontSize: '13px',
    lineHeight: 1.4,
    overflow: 'hidden',
    textAlign: 'end',
    textOverflow: 'ellipsis',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 1,
    wordBreak: 'break-word',
  },
  labelActive: {
    color: cssVar.colorPrimary,
    fontWeight: 500,
  },
  list: {
    'maxHeight': '60vh',
    'overflowY': 'auto',
    'paddingBlock': '4px',
    'paddingInline': '4px',
    'scrollbarWidth': 'thin',
    '::-webkit-scrollbar': {
      width: '4px',
    },
    '::-webkit-scrollbar-thumb': {
      backgroundColor: cssVar.colorFillSecondary,
      backgroundImage: 'none',
      borderRadius: '2px',
    },
  },
});

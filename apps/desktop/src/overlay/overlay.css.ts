import { createGlobalTheme, globalStyle, style } from '@vanilla-extract/css';

const overlayTheme = {
  color: {
    highlightBorder: 'rgba(241, 246, 255, 0.96)',
    highlightFill: 'rgba(99, 138, 255, 0.16)',
    scrim: 'rgba(4, 9, 20, 0.28)',
    scrimGlow: 'rgba(82, 124, 255, 0.12)',
    selectionBorder: 'rgba(255, 255, 255, 0.9)',
    selectionFill: 'rgba(99, 138, 255, 0.16)',
    tagBackground: 'rgba(15, 23, 42, 0.88)',
    tagBorder: 'rgba(255, 255, 255, 0.16)',
    tagDivider: 'rgba(255, 255, 255, 0.42)',
    tagMuted: 'rgba(226, 232, 240, 0.76)',
    tagText: 'rgba(248, 250, 252, 0.96)',
  },
  font: {
    system: 'system-ui, sans-serif',
  },
  radius: {
    highlight: '14px',
    selection: '14px',
    tag: '999px',
  },
  shadow: {
    highlight:
      '0 0 0 1px rgba(99, 138, 255, 0.18), 0 12px 32px rgba(2, 8, 23, 0.24), 0 0 0 6px rgba(99, 138, 255, 0.08)',
    selection: '0 0 0 1px rgba(99, 138, 255, 0.24), 0 16px 36px rgba(2, 8, 23, 0.18)',
    tag: '0 10px 24px rgba(0, 0, 0, 0.24)',
  },
} as const;

const vars = createGlobalTheme(':root', overlayTheme);

globalStyle('*', {
  boxSizing: 'border-box',
});

globalStyle('html, body, #root', {
  height: '100%',
  margin: 0,
  overflow: 'hidden',
});

globalStyle('body', {
  background: 'transparent',
  color: vars.color.tagText,
  fontFamily: vars.font.system,
  userSelect: 'none',
  WebkitFontSmoothing: 'antialiased',
});

const overlayFrame = style({
  overflow: 'hidden',
  pointerEvents: 'none',
  position: 'absolute',
});

const overlayInsetFrame = {
  '::after': {
    borderRadius: 'inherit',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
    content: '',
    inset: 0,
    position: 'absolute',
  },
} as const;

export const overlay = style({
  'background': [
    `radial-gradient(circle at top center, ${vars.color.scrimGlow}, transparent 36%)`,
    `linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 24%)`,
    vars.color.scrim,
  ].join(', '),
  'height': '100vh',
  'inset': 0,
  'isolation': 'isolate',
  'position': 'fixed',
  'userSelect': 'none',
  'width': '100vw',
  '::before': {
    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 20%)',
    content: '',
    inset: 0,
    pointerEvents: 'none',
    position: 'absolute',
  },
});

export const windowHighlight = style([
  overlayFrame,
  overlayInsetFrame,
  {
    background: `linear-gradient(180deg, rgba(99, 138, 255, 0.16), ${vars.color.highlightFill})`,
    border: `1.5px solid ${vars.color.highlightBorder}`,
    borderRadius: vars.radius.highlight,
    boxShadow: vars.shadow.highlight,
  },
]);

export const windowTag = style({
  alignItems: 'center',
  backdropFilter: 'blur(12px)',
  background: vars.color.tagBackground,
  border: `1px solid ${vars.color.tagBorder}`,
  borderRadius: vars.radius.tag,
  boxShadow: vars.shadow.tag,
  display: 'flex',
  gap: 8,
  minHeight: 32,
  minWidth: 0,
  padding: '6px 12px',
  pointerEvents: 'none',
  position: 'absolute',
  zIndex: 10,
});

const windowTagText = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const windowTagApp = style([
  windowTagText,
  {
    color: vars.color.tagText,
    flex: '0 1 auto',
    fontSize: 12,
    fontWeight: 650,
    letterSpacing: '0.01em',
  },
]);

export const windowTagDivider = style({
  color: vars.color.tagDivider,
  flex: 'none',
  fontSize: 10,
});

export const windowTagTitle = style([
  windowTagText,
  {
    color: vars.color.tagMuted,
    flex: '1 1 auto',
    fontSize: 12,
    fontWeight: 500,
  },
]);

export const selection = style([
  overlayFrame,
  overlayInsetFrame,
  {
    background: `linear-gradient(180deg, rgba(99, 138, 255, 0.18), ${vars.color.selectionFill})`,
    border: `1px solid ${vars.color.selectionBorder}`,
    borderRadius: vars.radius.selection,
    boxShadow: vars.shadow.selection,
  },
]);

export const hintPill = style([
  windowTag,
  {
    bottom: 24,
    left: 24,
    minHeight: 28,
    padding: '4px 14px',
    position: 'fixed',
    userSelect: 'none',
    zIndex: 20,
  },
]);

export const hintPillKey = style({
  color: vars.color.tagText,
  flex: 'none',
  fontSize: 12,
  fontWeight: 650,
  letterSpacing: '0.01em',
});

export const hintPillDivider = style({
  color: vars.color.tagDivider,
  flex: 'none',
  fontSize: 10,
});

export const hintPillLabel = style({
  color: vars.color.tagMuted,
  flex: 'none',
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: 'nowrap',
});

export const hintPillGroupDivider = style({
  background: vars.color.tagDivider,
  flex: 'none',
  height: 12,
  margin: '0 4px',
  opacity: 0.4,
  width: 1,
});

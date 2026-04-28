import { globalStyle, keyframes, style } from '@vanilla-extract/css';

import { OVERLAY_LAYOUT } from './constants';

const vars = {
  colorBgElevated: '--lobe-overlay-bg-elevated',
  colorBorderSecondary: '--lobe-overlay-border-secondary',
  colorFill: '--lobe-overlay-fill',
  colorFillQuaternary: '--lobe-overlay-fill-quaternary',
  colorFillSecondary: '--lobe-overlay-fill-secondary',
  colorFillTertiary: '--lobe-overlay-fill-tertiary',
  colorPrimary: '--lobe-overlay-primary',
  colorPrimaryActive: '--lobe-overlay-primary-active',
  colorPrimaryHover: '--lobe-overlay-primary-hover',
  colorText: '--lobe-overlay-text',
  colorTextLightSolid: '--lobe-overlay-text-light-solid',
  colorTextQuaternary: '--lobe-overlay-text-quaternary',
  colorTextSecondary: '--lobe-overlay-text-secondary',
  colorTextTertiary: '--lobe-overlay-text-tertiary',
  panelBorder: '--lobe-overlay-panel-border',
  panelShadow: '--lobe-overlay-shadow',
} as const;

const v = (name: string) => `var(${name})`;

const font = {
  mono: "'SF Mono', ui-monospace, Menlo, monospace",
  system:
    "'SF Pro Display', 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

const radius = {
  button: 8,
  chip: 12,
  kbd: 4,
  panel: 12,
  thumb: 6,
} as const;

const motion = {
  enter: 'cubic-bezier(0.22, 1, 0.36, 1)',
  spring: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

export const panel = style({
  'background': v(vars.colorBgElevated),
  'backdropFilter': 'blur(14px)',
  'WebkitBackdropFilter': 'blur(14px)',
  'border': `1px solid ${v(vars.panelBorder)}`,
  'borderRadius': radius.panel,
  'boxShadow': v(vars.panelShadow),
  'color': v(vars.colorText),
  'fontFamily': font.system,
  'overflow': 'hidden',
  'pointerEvents': 'auto',
  'position': 'fixed',
  'transition': `left 420ms ${motion.spring}, top 420ms ${motion.spring}, width 320ms ${motion.enter}`,
  'willChange': 'left, top, width',
  'zIndex': 20,
  'vars': {
    [vars.colorBgElevated]: '#ffffff',
    [vars.colorBorderSecondary]: '#eeeeee',
    [vars.colorFill]: 'rgba(0, 0, 0, 0.12)',
    [vars.colorFillSecondary]: 'rgba(0, 0, 0, 0.06)',
    [vars.colorFillTertiary]: 'rgba(0, 0, 0, 0.03)',
    [vars.colorFillQuaternary]: 'rgba(0, 0, 0, 0.015)',
    [vars.colorPrimary]: '#222222',
    [vars.colorPrimaryActive]: '#111111',
    [vars.colorPrimaryHover]: '#333333',
    [vars.colorText]: '#080808',
    [vars.colorTextLightSolid]: '#f8f8f8',
    [vars.colorTextSecondary]: '#666666',
    [vars.colorTextTertiary]: '#999999',
    [vars.colorTextQuaternary]: '#bbbbbb',
    [vars.panelBorder]: 'rgba(0, 0, 0, 0.12)',
    [vars.panelShadow]: '0 4px 4px color-mix(in srgb, #000 4%, transparent)',
  },
  '@media': {
    '(prefers-color-scheme: dark)': {
      vars: {
        [vars.colorBgElevated]: '#1a1a1a',
        [vars.colorBorderSecondary]: '#1a1a1a',
        [vars.colorFill]: 'rgba(255, 255, 255, 0.16)',
        [vars.colorFillSecondary]: 'rgba(255, 255, 255, 0.1)',
        [vars.colorFillTertiary]: 'rgba(255, 255, 255, 0.06)',
        [vars.colorFillQuaternary]: 'rgba(255, 255, 255, 0.02)',
        [vars.colorPrimary]: '#eeeeee',
        [vars.colorPrimaryActive]: '#cccccc',
        [vars.colorPrimaryHover]: '#ffffff',
        [vars.colorText]: '#ffffff',
        [vars.colorTextLightSolid]: '#000000',
        [vars.colorTextSecondary]: '#aaaaaa',
        [vars.colorTextTertiary]: '#6f6f6f',
        [vars.colorTextQuaternary]: '#555555',
        [vars.panelBorder]: 'rgba(255, 255, 255, 0.1)',
        [vars.panelShadow]: '0 4px 4px color-mix(in srgb, #000 40%, transparent)',
      },
    },
  },
});

export const selectionSummary = style({
  alignItems: 'center',
  borderBottom: `1px solid ${v(vars.colorBorderSecondary)}`,
  display: 'flex',
  gap: 10,
  padding: '10px 12px',
});

export const thumb = style({
  background: v(vars.colorFillTertiary),
  backgroundPosition: 'center',
  backgroundSize: 'cover',
  border: `1px solid ${v(vars.colorBorderSecondary)}`,
  borderRadius: radius.thumb,
  flexShrink: 0,
  height: 40,
  overflow: 'hidden',
  position: 'relative',
  width: 40,
});

export const summaryText = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  gap: 2,
  minWidth: 0,
});

export const summaryTitle = style({
  color: v(vars.colorText),
  fontSize: 13,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const summaryMeta = style({
  color: v(vars.colorTextQuaternary),
  fontFamily: font.mono,
  fontSize: 11,
  letterSpacing: '0.01em',
});

export const iconBtn = style({
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: radius.button,
  color: v(vars.colorTextSecondary),
  cursor: 'pointer',
  display: 'inline-flex',
  height: 28,
  justifyContent: 'center',
  transition: `background 120ms ease, color 120ms ease`,
  width: 28,
  selectors: {
    '&:hover': {
      background: v(vars.colorFillSecondary),
      color: v(vars.colorText),
    },
    '&:active': { background: v(vars.colorFill) },
  },
});

export const multiSelectionSummary = style({
  borderBottom: `1px solid ${v(vars.colorBorderSecondary)}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 12px',
});

export const multiSelectionHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
});

export const multiSelectionTitle = style({
  color: v(vars.colorText),
  fontSize: 13,
  fontWeight: 600,
});

export const multiSelectionMeta = style({
  color: v(vars.colorTextQuaternary),
  fontFamily: font.mono,
  fontSize: 11,
  letterSpacing: '0.01em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const multiSelectionRail = style({
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  paddingBottom: 2,
  scrollbarWidth: 'none',
});

export const multiSelectionItem = style({
  background: v(vars.colorFillQuaternary),
  border: `1px solid ${v(vars.colorBorderSecondary)}`,
  borderRadius: 10,
  display: 'flex',
  flex: '0 0 104px',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
  padding: 6,
});

export const multiSelectionItemActive = style({
  background: v(vars.colorFillTertiary),
  borderColor: `color-mix(in srgb, ${v(vars.colorText)} 12%, ${v(vars.colorBorderSecondary)} 88%)`,
});

export const multiSelectionThumbFrame = style({
  position: 'relative',
});

export const multiSelectionThumb = style({
  background: v(vars.colorFillTertiary),
  backgroundPosition: 'center',
  backgroundSize: 'cover',
  border: `1px solid ${v(vars.colorBorderSecondary)}`,
  borderRadius: 8,
  height: 58,
  overflow: 'hidden',
  width: '100%',
});

export const multiSelectionRemoveBtn = style({
  alignItems: 'center',
  background: `color-mix(in srgb, ${v(vars.colorBgElevated)} 82%, transparent)`,
  border: `1px solid ${v(vars.colorBorderSecondary)}`,
  borderRadius: 999,
  color: v(vars.colorTextSecondary),
  cursor: 'pointer',
  display: 'inline-flex',
  height: 22,
  justifyContent: 'center',
  padding: 0,
  position: 'absolute',
  right: 6,
  top: 6,
  transition: `background 120ms ease, color 120ms ease, transform 120ms ease`,
  width: 22,
  selectors: {
    '&:hover': {
      background: v(vars.colorBgElevated),
      color: v(vars.colorText),
    },
    '&:active': {
      transform: 'scale(0.94)',
    },
  },
});

export const multiSelectionItemLabel = style({
  color: v(vars.colorText),
  fontSize: 11,
  fontWeight: 600,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const inputRow = style({
  display: 'flex',
  padding: '10px 12px 4px',
});

export const textarea = style({
  background: 'transparent',
  border: 'none',
  color: v(vars.colorText),
  display: 'block',
  fontFamily: 'inherit',
  flex: 1,
  fontSize: 14,
  lineHeight: 1.5,
  maxHeight: 160,
  minHeight: 44,
  outline: 'none',
  padding: 0,
  resize: 'none',
  selectors: {
    '&::placeholder': { color: v(vars.colorTextTertiary) },
  },
});

export const actionBar = style({
  alignItems: 'center',
  display: 'flex',
  gap: 8,
  padding: '4px 8px 8px 10px',
});

export const actionBarLeft = style({
  alignItems: 'center',
  display: 'flex',
  flex: 1,
  gap: 4,
  minWidth: 0,
});

export const actionBarRight = style({
  alignItems: 'center',
  display: 'flex',
  flexShrink: 0,
  gap: 8,
});

export const selectChip = style({
  alignItems: 'center',
  background: v(vars.colorFillTertiary),
  border: 'none',
  borderRadius: radius.chip,
  color: v(vars.colorText),
  cursor: 'pointer',
  display: 'inline-flex',
  fontSize: 12,
  fontWeight: 500,
  gap: 6,
  height: 32,
  maxWidth: 180,
  minWidth: 0,
  padding: '0 10px 0 6px',
  position: 'relative',
  transition: 'background 120ms ease',
  selectors: {
    '&:hover': {
      background: v(vars.colorFillSecondary),
    },
  },
});

export const selectChipDisabled = style({
  cursor: 'not-allowed',
  opacity: 0.55,
  selectors: {
    '&:hover': {
      background: v(vars.colorFillTertiary),
    },
  },
});

export const chipLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const chevron = style({
  color: v(vars.colorTextQuaternary),
  flexShrink: 0,
});

export const nativeSelect = style({
  appearance: 'none',
  background: 'transparent',
  border: 'none',
  color: 'transparent',
  cursor: 'pointer',
  fontSize: 'inherit',
  inset: 0,
  margin: 0,
  opacity: 0,
  outline: 'none',
  padding: 0,
  position: 'absolute',
  width: '100%',
  selectors: {
    '&:disabled': { cursor: 'not-allowed' },
  },
});

export const modelIconBox = style({
  alignItems: 'center',
  display: 'inline-flex',
  flexShrink: 0,
  height: 20,
  justifyContent: 'center',
  width: 20,
});

export const modelIconBoxFallback = style({
  background: v(vars.colorFillSecondary),
  borderRadius: 5,
  flexShrink: 0,
  height: 20,
  width: 20,
});

export const shortcutHint = style({
  alignItems: 'center',
  color: v(vars.colorTextQuaternary),
  display: 'inline-flex',
  fontSize: 11,
  gap: 4,
  userSelect: 'none',
});

export const shortcutKbd = style({
  alignItems: 'center',
  background: v(vars.colorFillQuaternary),
  border: `1px solid ${v(vars.colorBorderSecondary)}`,
  borderRadius: radius.kbd,
  color: v(vars.colorTextSecondary),
  display: 'inline-flex',
  fontFamily: font.mono,
  fontSize: 10,
  fontWeight: 500,
  height: 16,
  justifyContent: 'center',
  minWidth: 16,
  padding: '0 4px',
});

export const sendBtn = style({
  alignItems: 'center',
  background: v(vars.colorBgElevated),
  border: `1px solid ${v(vars.colorBgElevated)}`,
  borderRadius: radius.button,
  cursor: 'pointer',
  color: v(vars.colorText),
  display: 'inline-flex',
  flexShrink: 0,
  height: 32,
  justifyContent: 'center',
  padding: 0,
  transition: `background-color 0.2s cubic-bezier(0.645, 0.045, 0.355, 1), border-color 0.2s cubic-bezier(0.645, 0.045, 0.355, 1), color 0.2s cubic-bezier(0.645, 0.045, 0.355, 1), transform 140ms ${motion.spring}`,
  width: 32,
  selectors: {
    '&:hover:not(:disabled)': {
      background: `color-mix(in srgb, ${v(vars.colorBgElevated)} 88%, ${v(vars.colorText)} 12%)`,
      borderColor: `color-mix(in srgb, ${v(vars.colorBgElevated)} 88%, ${v(vars.colorText)} 12%)`,
    },
    '&:active:not(:disabled)': {
      background: `color-mix(in srgb, ${v(vars.colorBgElevated)} 92%, #000 8%)`,
      borderColor: `color-mix(in srgb, ${v(vars.colorBgElevated)} 92%, #000 8%)`,
      transform: 'scale(0.94)',
    },
    '&:disabled': {
      background: 'transparent',
      borderColor: v(vars.colorBgElevated),
      color: v(vars.colorTextQuaternary),
      cursor: 'default',
    },
  },
});

export const connector = style({
  background: v(vars.colorPrimary),
  borderRadius: '50%',
  boxShadow: `0 0 0 4px ${v(vars.colorFillSecondary)}, 0 0 16px ${v(vars.colorPrimary)}`,
  height: OVERLAY_LAYOUT.connectorSize,
  opacity: 0,
  pointerEvents: 'none',
  position: 'fixed',
  transition: `opacity 200ms ${motion.enter} 140ms, left 320ms ${motion.spring}, top 320ms ${motion.spring}`,
  width: OVERLAY_LAYOUT.connectorSize,
  zIndex: 15,
});

export const connectorVisible = style({
  opacity: 1,
});

export const connectorHidden = style({
  opacity: 0,
  transitionDelay: '0ms',
  visibility: 'hidden',
});

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translate(-50%, 8px)' },
  to: { opacity: 1, transform: 'translate(-50%, 0)' },
});

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

export const uploadOverlay = style({
  alignItems: 'center',
  backdropFilter: 'blur(2px)',
  borderRadius: 'inherit',
  color: v(vars.colorTextLightSolid),
  display: 'flex',
  inset: 0,
  justifyContent: 'center',
  pointerEvents: 'none',
  position: 'absolute',
});

export const uploadOverlayUploading = style({
  background: 'color-mix(in srgb, #000 36%, transparent)',
});

export const uploadOverlayFailed = style({
  background: 'color-mix(in srgb, #e53935 55%, transparent)',
});

export const uploadSpinnerIcon = style({
  animation: `${spin} 0.9s linear infinite`,
});

export const initialEnter = style({
  animation: `${fadeIn} 280ms ${motion.enter}`,
});

export const panelHidden = style({
  opacity: 0,
  pointerEvents: 'none',
  visibility: 'hidden',
});

globalStyle(`.${multiSelectionRail}::-webkit-scrollbar`, {
  display: 'none',
});

globalStyle(`.${textarea}::selection`, {
  background: 'color-mix(in srgb, var(--lobe-overlay-primary) 22%, transparent)',
});

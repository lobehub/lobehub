import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { artboardTokens } from '../tokens.stylex';

const appear = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(24px)' },
});

const flash = stylex.keyframes({
  '0%': { boxShadow: `0 0 0 0 ${cssVar.colorPrimary}` },
  '30%': { boxShadow: `0 0 0 14px ${cssVar.colorPrimaryBg}` },
  '100%': { boxShadow: '0 0 0 0 transparent' },
});

export const canvasStyles = stylex.create({
  appear: {
    animationDuration: '0.4s',
    animationName: appear,
    animationTimingFunction: 'ease-out',
  },
  edgeBranch: {
    backgroundColor: cssVar.colorBgContainer,
    borderRadius: 999,
    color: cssVar.colorTextSecondary,
  },
  edgeLabel: {
    backgroundColor: cssVar.colorBgLayout,
    boxSizing: 'border-box',
    color: cssVar.colorText,
    fontWeight: 500,
    lineHeight: 1.4,
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
    textOverflow: 'ellipsis',
    transform: 'translate(-50%, -50%)',
    whiteSpace: 'nowrap',
    zIndex: 1,
  },
  edgeLabelFull: {
    zIndex: 3,
  },
  busy: {
    alignItems: 'center',
    backdropFilter: 'blur(2px)',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 72%, transparent)`,
    display: 'flex',
    fontSize: 15,
    gap: 8,
    inset: 0,
    justifyContent: 'center',
    position: 'absolute',
  },
  commenting: {
    cursor: 'crosshair',
  },
  cursor: {
    pointerEvents: 'none',
    position: 'absolute',
    transitionDuration: '0.8s',
    transitionProperty: 'transform',
    transitionTimingFunction: 'ease-in-out',
  },
  cursorName: {
    backgroundColor: cssVar.colorPrimary,
    borderRadius: 6,
    color: cssVar.colorBgContainer,
    fontSize: 12,
    paddingBlock: 2,
    paddingInline: 8,
    whiteSpace: 'nowrap',
  },
  drawing: {
    backgroundColor: cssVar.colorBgContainer,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    height: '100%',
    padding: 24,
  },
  flash: {
    animationDuration: '1.6s',
    animationName: flash,
    animationTimingFunction: 'ease-out',
  },
  board: {
    cursor: 'pointer',
    position: 'absolute',
    transitionDuration: '0.25s',
    transitionProperty: 'opacity',
  },
  boardCard: {
    backgroundColor: cssVar.colorBgContainer,
    height: '100%',
    outlineColor: cssVar.colorBorderSecondary,
    outlineStyle: 'solid',
    outlineWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  boardBare: {
    backgroundColor: 'transparent',
    outlineStyle: 'none',
    overflow: 'visible',
  },
  boardFrame: {
    borderColor: artboardTokens.accent,
    borderStyle: 'solid',
    boxSizing: 'border-box',
    inset: 0,
    pointerEvents: 'none',
    position: 'absolute',
  },
  boardRelated: {
    outlineColor: artboardTokens.selectionLine,
    outlineStyle: 'dashed',
  },
  boardSelected: {
    outlineColor: artboardTokens.selection,
    outlineStyle: 'solid',
  },
  inert: {
    pointerEvents: 'none',
  },
  muted: {
    opacity: 0.25,
    pointerEvents: 'none',
  },
  panning: {
    cursor: 'grabbing',
  },
  scaledLabel: {
    insetBlockEnd: '100%',
    insetInlineStart: 0,
    position: 'absolute',
    transformOrigin: '0 100%',
  },
  shotChip: {
    backgroundColor: cssVar.colorText,
    borderRadius: 6,
    color: cssVar.colorBgContainer,
    fontSize: 12,
    insetBlockEnd: 10,
    insetInlineEnd: 10,
    paddingBlock: 2,
    paddingInline: 8,
    position: 'absolute',
  },
  viewport: {
    backgroundColor: cssVar.colorBgLayout,
    color: cssVar.colorText,
    cursor: 'grab',
    fontFamily: cssVar.fontFamily,
    inset: 0,
    overflow: 'hidden',
    position: 'absolute',
    touchAction: 'none',
    userSelect: 'none',
  },
  world: {
    insetBlockStart: 0,
    insetInlineStart: 0,
    position: 'absolute',
    transformOrigin: '0 0',
  },
  worldFlying: {
    transitionDuration: '0.45s',
    transitionProperty: 'transform',
    transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
});

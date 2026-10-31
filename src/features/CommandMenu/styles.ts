import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const slideDown = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(-20px) scale(0.96)' },
  to: { opacity: 1, transform: 'translateY(0) scale(1)' },
});

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const slideUp = stylex.keyframes({
  from: { opacity: 1, transform: 'translateY(0) scale(1)' },
  to: { opacity: 0, transform: 'translateY(-20px) scale(0.96)' },
});

const fadeOut = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
});

const pulse = stylex.keyframes({
  '0%': { backgroundPosition: '200% 0' },
  '100%': { backgroundPosition: '-200% 0' },
});

const CLOSING = "[data-closing='true']";

export const styles = stylex.create({
  backTag: { cursor: 'pointer', fontSize: '12px' },
  chatContainer: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' },
  chatMessage: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    borderRadius: cssVar.borderRadius,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px',
  },
  chatMessageContent: { color: cssVar.colorText, fontSize: '14px', lineHeight: 1.6 },
  chatMessageRole: { color: cssVar.colorTextSecondary, fontSize: '12px', fontWeight: 500 },
  commandContainer: { display: 'flex', flexDirection: 'column' },
  commandFooter: {
    alignItems: 'center',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    paddingBlock: '12px',
    paddingInline: '16px',
  },
  // cmdk's inner elements are styled by styles.module.css (.root)
  commandRoot: {
    animationDuration: { default: '0.12s', [CLOSING]: '0.15s' },
    animationFillMode: { default: null, [CLOSING]: 'forwards' },
    animationName: { default: slideDown, [CLOSING]: slideUp },
    animationTimingFunction: 'ease-out',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    borderRadius: cssVar.borderRadiusLG,
    boxShadow: cssVar.boxShadowSecondary,
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'min(500px, 70vh)',
    overflow: 'hidden',
    width: 'min(640px, 90vw)',
  },
  contextTag: { fontSize: '12px' },
  contextWrapper: {
    alignItems: 'center',
    display: 'flex',
    gap: '8px',
    paddingBlock: '8px',
    paddingInline: '16px',
  },
  icon: { color: cssVar.colorTextSecondary, flexShrink: 0, height: '20px', width: '20px' },
  inputWrapper: {
    alignItems: 'center',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    display: 'flex',
    gap: '8px',
    paddingBlock: '12px',
    paddingInline: '16px',
  },
  itemContent: {
    alignItems: 'center',
    display: 'flex',
    flex: '1',
    gap: '12px',
    minWidth: 0,
  },
  itemDescription: {
    color: cssVar.colorTextTertiary,
    fontSize: '12px',
    lineHeight: 1.4,
    marginBlockStart: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemDetails: { flex: '1', minWidth: 0 },
  itemIcon: {
    alignItems: 'center',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    flexShrink: 0,
    height: '20px',
    justifyContent: 'center',
    width: '20px',
  },
  itemLabel: { fontSize: '14px', fontWeight: 500, lineHeight: 1.4 },
  itemTitle: {
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemType: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontSize: '11px',
    textTransform: 'capitalize',
  },
  kbd: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    gap: '4px',
  },
  kbdIcon: { color: cssVar.colorTextTertiary, height: '14px', width: '14px' },
  overlay: {
    alignItems: 'flex-start',
    animationDuration: { default: '0.1s', [CLOSING]: '0.15s' },
    animationFillMode: { default: null, [CLOSING]: 'forwards' },
    animationName: { default: fadeIn, [CLOSING]: fadeOut },
    animationTimingFunction: { default: 'ease-in-out', [CLOSING]: 'ease-out' },
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
    display: 'flex',
    inset: 0,
    justifyContent: 'center',
    paddingBlockStart: '15vh',
    position: 'fixed',
    zIndex: 9999,
  },
  skeleton: {
    animationDuration: '1.5s',
    animationIterationCount: 'infinite',
    animationName: pulse,
    animationTimingFunction: 'ease-in-out',
    backgroundColor: 'transparent',
    backgroundImage: `linear-gradient(90deg, ${cssVar.colorFillSecondary} 25%, ${cssVar.colorFillTertiary} 50%, ${cssVar.colorFillSecondary} 75%)`,
    backgroundSize: '200% 100%',
    borderRadius: cssVar.borderRadiusSM,
    height: '16px',
  },
  skeletonItem: {
    alignItems: 'center',
    display: 'flex',
    gap: '12px',
    paddingBlock: '12px',
    paddingInline: '16px',
  },
});

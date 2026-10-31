import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const slideUp = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(8px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

export const styles = stylex.create({
  chip: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '7px',
    paddingInlineStart: '10px',
    paddingInlineEnd: '14px',
    borderStyle: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transform: { default: 'translateY(8px)', [REDUCED_MOTION]: 'none' },
    opacity: { default: 0, [REDUCED_MOTION]: 1 },
    transition: 'background 0.15s, color 0.15s',
    animationName: { default: slideUp, [REDUCED_MOTION]: 'none' },
    animationDuration: '320ms',
    animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    animationFillMode: 'forwards',
  },
  chipIcon: {
    flex: 'none',
    color: { default: null, [stylex.when.ancestor(':hover')]: cssVar.colorPrimary },
    opacity: { default: 0.55, [stylex.when.ancestor(':hover')]: 1 },
    transition: 'opacity 0.15s, color 0.15s',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    alignItems: 'flex-start',
    maxInlineSize: '460px',
    marginBlockStart: '8px',
  },
});

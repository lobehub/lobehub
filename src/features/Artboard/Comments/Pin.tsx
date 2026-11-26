import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

import { artboardTokens } from '../tokens.stylex';
import { PIN_SIZE, type PinTone } from './layout';

const SIZE = 28;

const styles = stylex.create({
  dot: {
    backgroundColor: cssVar.colorWarning,
    borderColor: cssVar.colorWhite,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 2,
    height: 10,
    insetBlockStart: -4,
    insetInlineEnd: -4,
    position: 'absolute',
    width: 10,
  },
  open: {
    outlineColor: artboardTokens.selectionLine,
    outlineStyle: 'solid',
    outlineWidth: 3,
  },
  pin: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: artboardTokens.selection,
    borderColor: cssVar.colorWhite,
    borderStyle: 'solid',
    borderWidth: 2,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: '50%',
    borderTopLeftRadius: '50%',
    borderTopRightRadius: '50%',
    boxSizing: 'border-box',
    color: cssVar.colorWhite,
    cursor: 'pointer',
    display: 'flex',
    fontFamily: cssVar.fontFamily,
    fontSize: 11,
    fontWeight: 600,
    height: SIZE,
    justifyContent: 'center',
    lineHeight: 1,
    margin: 0,
    padding: 0,
    position: 'absolute',
    width: SIZE,
    zIndex: 7,
  },
  resolved: {
    backgroundColor: artboardTokens.resolved,
    color: artboardTokens.resolvedText,
  },
  stale: {
    backgroundColor: cssVar.colorBgLayout,
    borderColor: artboardTokens.stale,
    borderStyle: 'dashed',
    color: artboardTokens.stale,
  },
  waiting: {
    backgroundColor: cssVar.colorWarning,
  },
});

const toneStyles = {
  default: null,
  resolved: styles.resolved,
  stale: styles.stale,
  waiting: styles.waiting,
} as const;

interface PinProps {
  at: { x: number; y: number };
  label?: string;
  number?: number;
  onClick?: () => void;
  open?: boolean;
  tone?: PinTone;
  unsent?: boolean;
}

const Pin = ({ at, label, number, onClick, open, tone = 'default', unsent }: PinProps) => {
  const props = sx(styles.pin, toneStyles[tone], open && styles.open, {
    left: at.x,
    top: at.y - PIN_SIZE,
  });
  if (!onClick) return <span {...props} />;
  return (
    <button aria-label={label} aria-pressed={open} type="button" {...props} onClick={onClick}>
      {number}
      {unsent && <span {...stylex.props(styles.dot)} />}
    </button>
  );
};

export default Pin;

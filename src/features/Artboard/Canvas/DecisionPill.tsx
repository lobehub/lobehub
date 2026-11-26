import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

import { textWidth } from './boardLabelLayout';

const PILL_HEIGHT = 96;
const FONT_SIZE = 40;
const MIN_FONT_SIZE = 20;
const GLYPH = 28;
const GLYPH_GAP = 16;
const PADDING = 40;

const styles = stylex.create({
  glyph: {
    fill: 'none',
    flexShrink: 0,
    stroke: cssVar.colorText,
    strokeLinejoin: 'round',
    strokeWidth: 1.6,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderRadius: 999,
    boxSizing: 'border-box',
    color: cssVar.colorText,
    display: 'flex',
    fontWeight: 600,
    insetBlockStart: '50%',
    insetInlineStart: 0,
    justifyContent: 'center',
    lineHeight: 1,
    position: 'absolute',
    transform: 'translateY(-50%)',
    whiteSpace: 'nowrap',
    width: '100%',
  },
  text: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
});

interface DecisionPillProps {
  height: number;
  k: number;
  title: string;
  width: number;
}

const DecisionPill = ({ height, k, title, width }: DecisionPillProps) => {
  const fit = Math.min(1, height / PILL_HEIGHT);
  const room = width - (PADDING * 2 + GLYPH_GAP + GLYPH) * fit;
  const fontSize = Math.max(
    MIN_FONT_SIZE * fit,
    Math.min(FONT_SIZE * fit, (FONT_SIZE * room) / Math.max(1, textWidth(title, FONT_SIZE))),
  );
  return (
    <div
      title={title}
      {...sx(styles.pill, {
        boxShadow: `inset 0 0 0 ${Math.max(6, 2 / k)}px ${cssVar.colorText}`,
        fontSize,
        gap: GLYPH_GAP * fit,
        height: PILL_HEIGHT * fit,
        paddingInline: PADDING * fit,
      })}
    >
      <svg
        aria-hidden
        height={GLYPH * fit}
        viewBox="0 0 10 10"
        width={GLYPH * fit}
        {...stylex.props(styles.glyph)}
      >
        <path d="M5,0.9 L9.1,5 L5,9.1 L0.9,5 Z" />
      </svg>
      <span {...stylex.props(styles.text)}>{title}</span>
    </div>
  );
};

export default DecisionPill;

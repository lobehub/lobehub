'use client';

import type { AcceptanceFrameTransition } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const TRANSITION_WIDTH = 76;

const styles = stylex.create({
  root: {
    flexShrink: 0,
    paddingTop: 120,
    width: TRANSITION_WIDTH,
  },
  trigger: {
    backgroundColor: cssVar.colorFillTertiary,
    borderColor: 'transparent',
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorText,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    lineHeight: 1.35,
    paddingBlock: 2,
    paddingInline: 5,
    textAlign: 'center',
    wordBreak: 'break-word',
  },
  current: {
    backgroundColor: cssVar.colorPrimaryBg,
    borderColor: cssVar.colorPrimaryBorder,
  },
  line: {
    color: cssVar.colorTextTertiary,
    display: 'block',
    width: '100%',
  },
});

interface TransitionArrowProps {
  activeFrameId?: string;
  /** Following an arrow opens the frame it leads to. */
  onFollow: (frameId: string) => void;
  transitions: AcceptanceFrameTransition[];
}

/** The arrow between two neighbouring frames, labelled with what moves the UI on. */
const TransitionArrow = ({ activeFrameId, onFollow, transitions }: TransitionArrowProps) => (
  <Flexbox align={'center'} gap={4} {...stylex.props(styles.root)}>
    {transitions.map((transition) => (
      <button
        key={transition.id}
        title={transition.trigger}
        type={'button'}
        {...stylex.props(styles.trigger, activeFrameId === transition.toFrameId && styles.current)}
        onClick={() => onFollow(transition.toFrameId)}
      >
        {transition.trigger}
      </button>
    ))}
    <svg
      aria-hidden
      height={12}
      viewBox={`0 0 ${TRANSITION_WIDTH} 12`}
      {...stylex.props(styles.line)}
    >
      <line
        stroke={'currentColor'}
        strokeDasharray={transitions.length === 0 ? '3 3' : undefined}
        strokeWidth={1.5}
        x1={2}
        x2={TRANSITION_WIDTH - 4}
        y1={6}
        y2={6}
      />
      <path
        d={`M${TRANSITION_WIDTH - 10} 1 L${TRANSITION_WIDTH - 2} 6 L${TRANSITION_WIDTH - 10} 11`}
        fill={'none'}
        stroke={'currentColor'}
        strokeWidth={1.5}
      />
    </svg>
  </Flexbox>
);

export default TransitionArrow;

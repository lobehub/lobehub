'use client';

import type { CharacterPose, Facing } from '@lobechat/builtin-tool-mini-game';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { STEP_DURATION_MS } from '@/store/miniGame';
import { sx } from '@/styles/sx';

import { ART } from './palette';

const bob = stylex.keyframes({
  '0%': { transform: 'translateY(0px)' },
  '50%': { transform: 'translateY(-3px)' },
  '100%': { transform: 'translateY(0px)' },
});

const twinkle = stylex.keyframes({
  '0%': { opacity: 0.2 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.2 },
});

const styles = stylex.create({
  body: {
    transformBox: 'fill-box',
    transformOrigin: 'center',
  },
  mirrored: {
    transform: 'scaleX(-1)',
  },
  root: {
    pointerEvents: 'none',
    transitionProperty: 'transform',
    transitionTimingFunction: 'linear',
  },
  twinkle: {
    animationDuration: '1.6s',
    animationIterationCount: 'infinite',
    animationName: twinkle,
  },
  walking: {
    animationDuration: '0.32s',
    animationIterationCount: 'infinite',
    animationName: bob,
  },
});

interface CharacterProps {
  facing: Facing;
  /** Center of the character's feet, in viewBox pixels. */
  pixel: { x: number; y: number };
  pose: CharacterPose;
}

/** The agent's avatar in the yard. Moves by CSS transition between cells. */
const Character = memo<CharacterProps>(({ facing, pixel, pose }) => {
  const sitting = pose === 'sitting';
  const backTurned = facing === 'north';

  return (
    <g
      data-pose={pose}
      data-testid="mini-game-character"
      {...sx([styles.root], undefined, {
        transform: `translate(${pixel.x}px, ${pixel.y}px)`,
        transitionDuration: `${STEP_DURATION_MS}ms`,
      })}
    >
      <ellipse cx={0} cy={0} fill={ART.outline} opacity={0.18} rx={9} ry={3} />
      <g {...stylex.props(styles.body, pose === 'walking' && styles.walking)}>
        <g {...stylex.props(facing === 'west' && styles.mirrored)}>
          {sitting ? (
            <>
              <rect fill={ART.pants} height={5} rx={2} width={12} x={-3} y={-10} />
              <rect fill={ART.pants} height={7} width={4} x={6} y={-8} />
            </>
          ) : (
            <>
              <rect fill={ART.pants} height={8} width={4} x={-5} y={-8} />
              <rect fill={ART.pants} height={8} width={4} x={1} y={-8} />
            </>
          )}
          <rect
            fill={ART.shirt}
            height={12}
            rx={3}
            stroke={ART.outline}
            strokeWidth={1}
            width={14}
            x={-7}
            y={sitting ? -21 : -19}
          />
          <circle
            cx={0}
            cy={sitting ? -28 : -26}
            fill={ART.skin}
            r={8}
            stroke={ART.outline}
            strokeWidth={1}
          />
          <path
            fill={ART.hair}
            d={
              backTurned
                ? `M-8 ${sitting ? -28 : -26} a8 8 0 0 1 16 0 v2 h-16 z`
                : `M-8 ${sitting ? -29 : -27} a8 8 0 0 1 16 0 h-4 l-2 -3 l-2 3 z`
            }
          />
          {!backTurned && (
            <>
              <rect fill={ART.outline} height={2} width={2} x={1} y={sitting ? -28 : -26} />
              <rect
                fill={ART.outline}
                height={2}
                width={2}
                x={facing === 'south' ? -4 : 5}
                y={sitting ? -28 : -26}
              />
            </>
          )}
        </g>
      </g>
      {pose === 'watching' && (
        <g {...stylex.props(styles.twinkle)}>
          <path d="M12 -38 l2 -5 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 z" fill={ART.windowLight} />
        </g>
      )}
    </g>
  );
});

Character.displayName = 'MiniGameCharacter';

export default Character;

'use client';

import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';

import { useBlindBoxSeed } from './useBlindBoxSeed';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const fadeOut = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
});

const styles = stylex.create({
  stack: {
    position: 'relative',
    display: 'inline-flex',
    flexShrink: 0,
  },
  // The outgoing character sits on top of the incoming one in the same box.
  outgoing: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    display: 'inline-flex',
    pointerEvents: 'none',
    animationName: fadeOut,
    animationDuration: {
      'default': '600ms',
      '@media (prefers-reduced-motion: reduce)': '0s',
    },
    animationTimingFunction: 'ease-in-out',
    animationFillMode: 'forwards',
  },
  incoming: {
    display: 'inline-flex',
    animationName: fadeIn,
    animationDuration: {
      'default': '600ms',
      '@media (prefers-reduced-motion: reduce)': '0s',
    },
    animationTimingFunction: 'ease-in-out',
    animationFillMode: 'both',
  },
});

interface BlindBoxAvatarProps {
  className?: string;
  name?: string;
  size: number;
}

/**
 * The generated agent character, cross-fading to a new one every couple of
 * seconds: the agent's real character is decided by an id it does not have yet.
 */
const BlindBoxAvatar = memo<BlindBoxAvatarProps>(({ className, name, size }) => {
  const { seed, previousSeed } = useBlindBoxSeed(true);

  return (
    <span className={[stylex.props(styles.stack).className, className].filter(Boolean).join(' ')}>
      {/* Keyed by seed so each swap remounts both layers and replays the fades. */}
      <span {...stylex.props(styles.incoming)} key={seed}>
        <AgentAvatar agentId={seed} name={name} size={size} />
      </span>
      {previousSeed && (
        <span {...stylex.props(styles.outgoing)} key={previousSeed}>
          <AgentAvatar agentId={previousSeed} name={name} size={size} />
        </span>
      )}
    </span>
  );
});

export default BlindBoxAvatar;

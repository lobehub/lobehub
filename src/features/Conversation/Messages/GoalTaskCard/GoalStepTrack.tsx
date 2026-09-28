'use client';

import type { GoalNodeStatus } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

import { buildGoalStepSegments } from './goalTaskProgress';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorInfo};
    animation: goal-step-active-pulse 1.6s ${cssVar.motionEaseInOut} infinite;
  `,
  done: css`
    background: ${cssVar.colorSuccess};
  `,
  pending: css`
    background: ${cssVar.colorFillSecondary};
  `,
  segment: css`
    flex: 1;
    height: 4px;
    border-radius: 2px;
  `,
  track: css`
    display: flex;
    gap: 3px;

    min-width: 96px;
    max-width: 320px;
    height: 4px;

    @keyframes goal-step-active-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.45;
      }
    }
  `,
}));

export interface GoalStepTrackProps {
  statuses: GoalNodeStatus[];
  /** Criteria-count fallback for a goal whose graph has not been seeded yet. */
  total: number;
}

/**
 * The Goal's Tasks as a row of step segments: closed steps fill success, the
 * running step pulses info, and the rest stay neutral — the plan reads as
 * steps advancing left to right, not one anonymous bar. Before the graph is
 * seeded the count is only a draft, so the track shows that many pending
 * segments instead of disappearing. Companion count text carries the numbers,
 * so the track stays decorative.
 */
const GoalStepTrack = memo<GoalStepTrackProps>(({ statuses, total }) => {
  const segments = buildGoalStepSegments(
    statuses.length > 0 ? statuses : Array.from({ length: total }, () => 'proposed' as const),
  );
  if (segments.length === 0) return null;

  return (
    <div aria-hidden className={styles.track}>
      {segments.map((state, index) => (
        <div className={cx(styles.segment, styles[state])} key={index} />
      ))}
    </div>
  );
});

GoalStepTrack.displayName = 'GoalStepTrack';

export default GoalStepTrack;

'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GoalRoundPopover from './GoalRoundPopover';

interface GoalRound {
  report: { verdict?: string | null } | null;
  run: {
    createdAt: Date | string;
    id?: string;
    roundIndex?: number | null;
    status?: string | null;
    /** Last write to the row — the closest thing to "when this round ended". */
    updatedAt?: Date | string | null;
  };
  /** Owner-only: what the round spent. Absent for shared links and old rows. */
  usage?: { cost: number; tokens: number } | null;
}

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    position: absolute;
    inset-block-end: -2px;
    inset-inline-end: -2px;

    width: 7px;
    height: 7px;
    border: 2px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    background: ${cssVar.colorError};
  `,
  rail: css`
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;

    min-width: 0;
  `,
  round: css`
    cursor: pointer;

    position: relative;

    height: 11px;
    border-radius: 4px;

    background: ${cssVar.colorInfoBgHover};

    transition:
      transform 0.15s,
      filter 0.15s;

    &[data-active='true'] {
      background: ${cssVar.colorInfo};
    }

    /* Grow vertically and brighten — never horizontally: width is what encodes
      the round's duration, so stretching it on hover would lie about the data. */
    &:hover {
      transform: scaleY(1.45);
      filter: brightness(1.25);
    }
  `,
  total: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const formatGoalDuration = (milliseconds: number) => {
  const minutes = milliseconds / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = milliseconds / 3_600_000;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Number((hours / 24).toFixed(1))}d`;
};

export const shouldShowGoalRoundTimeline = (roundCount: number) => roundCount > 1;

const SETTLED_RUN_STATUSES = new Set(['passed', 'failed', 'errored']);

export const isSettledRound = (status?: string | null): boolean =>
  Boolean(status && SETTLED_RUN_STATUSES.has(status));

/**
 * When a round stopped.
 *
 * A settled round must not keep measuring against the clock: reopening the
 * task days later would otherwise bill those idle days to the last round and
 * stretch its bar accordingly. Only a round still in flight runs up to now.
 */
export const goalRoundEnd = (
  run: { status?: string | null; updatedAt?: Date | string | null },
  now: number,
): number => {
  if (!isSettledRound(run.status) || !run.updatedAt) return now;
  const settled = new Date(run.updatedAt).getTime();
  return Number.isFinite(settled) ? settled : now;
};

/** Narrowest a round can render and still read as a block rather than a tick. */
const ROUND_BASE_WIDTH = 28;
/** Beyond this a long round would push the rail past the panel. */
const ROUND_MAX_WIDTH = 160;

/**
 * Round width tracks how long the round actually took, anchored on the first
 * round's duration. Stretching every round to fill the panel made two rounds
 * of wildly different lengths look identical — and made two rounds look like a
 * full bar, as if the budget were spent.
 */
export const goalRoundWidth = (durationMs: number, baseMs: number): number => {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || baseMs <= 0) return ROUND_BASE_WIDTH;
  const scaled = ROUND_BASE_WIDTH * (durationMs / baseMs);
  return Math.round(Math.min(ROUND_MAX_WIDTH, Math.max(ROUND_BASE_WIDTH, scaled)));
};

const GoalRoundTimeline = memo<{ rounds?: GoalRound[] }>(({ rounds = [] }) => {
  const { t } = useTranslation('chat');
  if (!shouldShowGoalRoundTimeline(rounds.length)) return null;

  const now = Date.now();
  const start = new Date(rounds[0].run.createdAt).getTime();

  // Each round spans until the next one opens; the last one until it settled,
  // or until now while it is still running.
  const durations = rounds.map(({ run }, index) => {
    const from = new Date(run.createdAt).getTime();
    const to =
      index + 1 < rounds.length
        ? new Date(rounds[index + 1].run.createdAt).getTime()
        : goalRoundEnd(run, now);
    return Math.max(1, to - from);
  });
  const base = durations[0];
  // Total ends where the last round ends, for the same reason.
  const elapsed = Math.max(1, goalRoundEnd(rounds.at(-1)!.run, now) - start);

  return (
    <Flexbox gap={8}>
      <Text fontSize={12} type={'secondary'}>
        {t('taskDetail.goalTimeline.title')}
      </Text>
      <div className={styles.rail}>
        {rounds.map(({ report, run, usage }, index) => (
          <GoalRoundPopover
            duration={formatGoalDuration(durations[index])}
            index={run.roundIndex ?? index + 1}
            key={`${run.roundIndex ?? index}-${new Date(run.createdAt).getTime()}`}
            status={run.status}
            usage={usage}
            verdict={report?.verdict}
          >
            <div
              className={styles.round}
              data-active={run.status === 'running' || index === rounds.length - 1}
              data-goal-round={run.roundIndex ?? index + 1}
              style={{ width: goalRoundWidth(durations[index], base) }}
            >
              {/* An agent-verified round may carry no report at all, so the
                run's own status is the more reliable failure signal. */}
              {(report?.verdict === 'failed' || run.status === 'failed') && (
                <span className={styles.dot} />
              )}
            </div>
          </GoalRoundPopover>
        ))}
        {/* Reads as the rail's own caption, right where the rounds end. */}
        <span className={styles.total}>
          {t('taskDetail.goalTimeline.rounds', { count: rounds.length })} ·{' '}
          {formatGoalDuration(elapsed)}
        </span>
      </div>
    </Flexbox>
  );
});

GoalRoundTimeline.displayName = 'GoalRoundTimeline';

export default GoalRoundTimeline;

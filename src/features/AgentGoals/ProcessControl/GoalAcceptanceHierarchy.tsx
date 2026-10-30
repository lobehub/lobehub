'use client';

import type { VerifyCheckTally } from '@lobechat/types';
import { Button, createStaticStyles, cssVar, cx, Flexbox, Icon } from '@lobehub/ui';
import {
  BadgeCheck,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CircleSlash,
  CircleX,
} from 'lucide-react';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { rowKeyDownHandler } from '@/features/Acceptance';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import type { AcceptanceLevelState, AcceptanceTree } from './goalAcceptanceTree';
import { GroupLabel } from './GoalResultFollowUps';
import { useAcceptanceSignOff } from './useAcceptanceSignOff';

const styles = createStaticStyles(({ css }) => ({
  /* One row per level. The row itself opens the level's acceptance report in
     the side Portal (the acceptance page's own criterion-row grammar), so the
     level's title, its sign-off, its count and the chevron are all inside one
     clickable band. */
  row: css`
    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 38px;
    padding-block: 8px;
    padding-inline: 12px 6px;

    /* The sign-off appears under the pointer, the way the acceptance page's own
       per-group accept does: a permanently visible button on every waiting row
       turns the list into a column of buttons and begs a misclick. */
    &:hover .acc-hierarchy-action {
      opacity: 1;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  rowInteractive: css`
    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  /* The row whose report the side Portal is showing, so the list still says
     which level the reader is looking at. */
  rowActive: css`
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowTarget: css`
    display: flex;
    flex: 1;
    gap: 10px;
    align-items: center;

    min-width: 0;
    padding: 0;
    border: none;

    color: inherit;
    text-align: start;

    background: none;
  `,
  rowTargetInteractive: css`
    cursor: pointer;
  `,
  /* Hover-revealed, and held visible while its own request is in flight: a
     spinner that disappears the moment the pointer leaves reads as "nothing
     happened". */
  levelAction: css`
    flex: none;
    opacity: 0;
    transition: opacity 0.15s;

    &:focus-within,
    &[data-pending='true'] {
      opacity: 1;
    }
  `,
  /* The task's position in the Goal graph, the same handle the process view
     refers to it by — quiet, but a step above the faintest tone so a row can
     still be read back and pointed at. */
  seq: css`
    flex: none;
    min-width: 22px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  /* Sized to its own text, so what follows it — the sign-off — sits directly
     after the title rather than out at the row's trailing edge. It still gives
     way (truncating) when the title is the long thing on the row. */
  title: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  /* Everything after the sign-off is right-aligned: the count is the row's own
     trailing meta, not a neighbour of the title. */
  spacer: css`
    flex: 1 1 0;
    min-width: 0;
  `,
  /* A level with nothing produced yet drops one step of text colour. A failed
     level keeps full weight: a failure is a result, an absence is not. */
  titleQuiet: css`
    color: ${cssVar.colorTextSecondary};
  `,
  meta: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/** A level's own state, as a glyph. Never derived from the levels beneath it. */
const LEVEL_GLYPH: Record<AcceptanceLevelState, typeof CircleDot> = {
  awaitingSignOff: CheckCircle2,
  closed: CircleSlash,
  inProgress: CircleDot,
  rejected: CircleX,
  signedOff: BadgeCheck,
  unavailable: CircleSlash,
};

const levelColor = (state: AcceptanceLevelState) =>
  state === 'awaitingSignOff'
    ? cssVar.colorSuccess
    : state === 'signedOff'
      ? cssVar.colorPrimary
      : state === 'rejected'
        ? cssVar.colorError
        : state === 'inProgress'
          ? cssVar.colorInfo
          : cssVar.colorTextTertiary;

const LEVEL_LABEL_KEY: Record<AcceptanceLevelState, string> = {
  awaitingSignOff: 'goalProcess.acceptanceHierarchy.level.awaitingSignOff',
  closed: 'goalProcess.acceptanceHierarchy.level.closed',
  inProgress: 'goalProcess.acceptanceHierarchy.level.inProgress',
  rejected: 'goalProcess.acceptanceHierarchy.level.rejected',
  signedOff: 'goalProcess.acceptanceHierarchy.level.signedOff',
  unavailable: 'goalProcess.acceptanceHierarchy.level.unavailable',
};

/** Counts read as words, never as a raw `3/4` fraction. */
const useTallyText = () => {
  const { t } = useTranslation('chat');
  return useCallback(
    (checks?: VerifyCheckTally) => {
      if (!checks) return undefined;
      const parts = [
        checks.passed > 0 &&
          t('goalProcess.acceptanceHierarchy.tally.passed', { count: checks.passed }),
        checks.unjudged > 0 &&
          t('goalProcess.acceptanceHierarchy.tally.unjudged', { count: checks.unjudged }),
        checks.failed > 0 &&
          t('goalProcess.acceptanceHierarchy.tally.failed', { count: checks.failed }),
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' · ') : undefined;
    },
    [t],
  );
};

interface LevelRowProps {
  /** Trailing level-scoped control — the one-click sign-off, when it applies. */
  action?: ReactNode;
  /** This level's report is the one the side Portal is showing. */
  active?: boolean;
  dim?: boolean;
  /** Why the row opens nothing, shown on hover when there is no `onOpen`. */
  hint?: string;
  meta?: string;
  /** Opens the level's acceptance report; absent when the task has none yet. */
  onOpen?: () => void;
  /** The task's position in the Goal graph, so a row can be pointed at. */
  seq?: string;
  state: AcceptanceLevelState;
  title: string;
}

const LevelRow = memo<LevelRowProps>(
  ({ action, active, dim, hint, meta, onOpen, seq, state, title }) => {
    const { t } = useTranslation('chat');
    return (
      <div
        className={cx(
          styles.row,
          onOpen && styles.rowInteractive,
          active && styles.rowActive,
          'acc-hierarchy-row',
        )}
      >
        <div
          className={cx(styles.rowTarget, onOpen && styles.rowTargetInteractive)}
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
          title={onOpen ? undefined : hint}
          onClick={onOpen}
          onKeyDown={onOpen ? rowKeyDownHandler(onOpen) : undefined}
        >
          <Icon
            aria-label={t(LEVEL_LABEL_KEY[state] as any)}
            color={levelColor(state)}
            icon={LEVEL_GLYPH[state]}
            size={16}
            style={{ flex: 'none' }}
          />
          {seq && <span className={styles.seq}>{seq}</span>}
          <span className={cx(styles.title, dim && styles.titleQuiet)}>{title}</span>
          {action}
          <span className={styles.spacer} />
          {meta && <span className={styles.meta}>{meta}</span>}
          {onOpen && (
            <Icon
              color={cssVar.colorTextQuaternary}
              icon={ChevronRight}
              size={15}
              style={{ flex: 'none' }}
            />
          )}
        </div>
      </div>
    );
  },
);
LevelRow.displayName = 'AcceptanceLevelRow';

export interface GoalAcceptanceHierarchyProps {
  /**
   * Whether the viewer may sign off. The page reads it from the goal-level
   * acceptance's bundle, which is the only permission the graph does not carry;
   * the tasks belong to the same goal and workspace, so they answer the same.
   */
  canReview: boolean;
  goalId: string;
  tree: AcceptanceTree;
}

/**
 * The per-task acceptance group of the result page's 验收标准 section: one row
 * per task that holds an acceptance of its own, each with its OWN tally,
 * opening that acceptance's report in the side Portal.
 *
 * Every row and every tally rides on the goal graph snapshot the page has
 * already loaded, so this renders with the page instead of adding a second
 * loading state beside it.
 *
 * Sign-off is offered at the two granularities the reader works at, and both
 * act on the level's OWN acceptance — never on a level derived from it:
 *
 * - a waiting row signs itself off under the pointer, and
 * - the group signs off every waiting row in one action.
 *
 * Two things this deliberately does NOT do:
 *
 * - It does not restate the goal-level acceptance. That is the criteria list
 *   above, under its own group label, with per-check evidence and reasons; a
 *   tally row here would state the same result twice. Signed off from here,
 *   the goal-level acceptance would also be a second home for the page's own
 *   decision strip — so the group action stops at the task rows it lists.
 * - It does not count a level the server did not count. A task with no round
 *   yet shows no tally rather than a row of zeroes.
 */
const GoalAcceptanceHierarchy = memo<GoalAcceptanceHierarchyProps>(
  ({ canReview, goalId, tree }) => {
    const { t } = useTranslation('chat');
    const openAcceptance = useChatStore((state) => state.openAcceptance);
    const openedAcceptanceId = useChatStore((state) =>
      chatPortalSelectors.showPortal(state)
        ? chatPortalSelectors.acceptancePortalId(state)
        : undefined,
    );
    const tallyText = useTallyText();
    const { acceptAll, acceptLevel, awaiting, pendingKey } = useAcceptanceSignOff(
      goalId,
      tree.tasks,
    );

    // No task holds an acceptance: the criteria list already carries the goal's
    // own result, so this group is absent rather than an empty heading.
    if (tree.tasks.length === 0) return null;

    const groupActions =
      canReview && awaiting.length > 0 ? (
        <Button icon={<Icon icon={CheckCheck} />} size={'small'} type={'text'} onClick={acceptAll}>
          {t('goalProcess.acceptanceHierarchy.acceptAll')}
        </Button>
      ) : undefined;

    return (
      <Flexbox gap={8}>
        <GroupLabel extra={groupActions}>{t('goalProcess.acceptanceHierarchy.group')}</GroupLabel>
        <Flexbox>
          {tree.tasks.map((level) => {
            const acceptanceId = level.acceptanceId;
            return (
              <LevelRow
                active={!!acceptanceId && acceptanceId === openedAcceptanceId}
                dim={level.state === 'unavailable'}
                hint={t('goalProcess.acceptanceHierarchy.taskNotDispatched')}
                key={level.key}
                meta={tallyText(level.checks)}
                seq={level.node.seq ? `#${level.node.seq}` : undefined}
                state={level.state}
                title={level.node.node.title}
                action={
                  canReview && level.state === 'awaitingSignOff' && acceptanceId ? (
                    <span
                      className={cx(styles.levelAction, 'acc-hierarchy-action')}
                      data-pending={pendingKey === level.key || undefined}
                    >
                      <Button
                        disabled={pendingKey !== null && pendingKey !== level.key}
                        icon={<Icon icon={BadgeCheck} />}
                        loading={pendingKey === level.key}
                        size={'small'}
                        type={'text'}
                        // The sign-off sits inside the row's own open target;
                        // acting on it must not also open the report.
                        onClick={(event) => {
                          event.stopPropagation();
                          void acceptLevel(level);
                        }}
                      >
                        {t('goalProcess.acceptanceHierarchy.accept')}
                      </Button>
                    </span>
                  ) : undefined
                }
                // The report itself is the drill-down — opened in the side
                // Portal like every other acceptance on this page, rather than a
                // second, thinner copy of its checks inlined under the row.
                onOpen={acceptanceId ? () => openAcceptance(acceptanceId) : undefined}
              />
            );
          })}
        </Flexbox>
      </Flexbox>
    );
  },
);

GoalAcceptanceHierarchy.displayName = 'GoalAcceptanceHierarchy';

export default GoalAcceptanceHierarchy;

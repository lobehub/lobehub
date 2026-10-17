'use client';

import type { VerifyCheckTally } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Skeleton,
  Text,
} from '@lobehub/ui';
import {
  BadgeCheck,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
  CircleSlash,
  CircleX,
  RotateCcw,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type AcceptanceCheck,
  checkDisplayTitle,
  checkHeadMeta,
  CriterionRow,
  rowKeyDownHandler,
  useAcceptanceBundle,
} from '@/features/Acceptance';
import { useChatStore } from '@/store/chat';

import type { AcceptanceLevelState, AcceptanceTree } from './goalAcceptanceTree';
import { GroupLabel } from './GoalResultFollowUps';
import { useAcceptanceSignOff } from './useAcceptanceSignOff';

const styles = createStaticStyles(({ css }) => ({
  /* One row per level. The row itself is the expand target (the acceptance
     page's own criterion-row grammar), so the level's title, its sign-off, its
     count and the chevron are all inside one clickable band. */
  row: css`
    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 38px;
    padding-block: 8px;
    padding-inline: 12px 6px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

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
  rowToggle: css`
    cursor: pointer;

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
  /* Check rows keep the acceptance page's own list grammar, so opening a level
     and opening the acceptance read as the same list.

     The offset is exactly the level row's icon column — its 16px mark plus the
     10px gap — so a check's mark lines up under the level's `#N`. The nesting
     reads from the sequence and the mark, not from a second indent. */
  nestedList: css`
    margin-block-end: 4px;
    margin-inline-start: 26px;
  `,
  /* "Nothing verified this" replaces a check list, so it starts on the same
     column as the checks' own marks — not a second indent. */
  empty: css`
    padding-block: 10px;
    padding-inline: 38px 12px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  error: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorErrorBg};
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
  chevron: typeof ChevronRight;
  dim?: boolean;
  meta?: string;
  onToggle: () => void;
  /** The task's position in the Goal graph, so a row can be pointed at. */
  seq?: string;
  state: AcceptanceLevelState;
  title: string;
}

const LevelRow = memo<LevelRowProps>(
  ({ action, chevron, dim, meta, onToggle, seq, state, title }) => {
    const { t } = useTranslation('chat');
    return (
      <div className={cx(styles.row, 'acc-hierarchy-row')}>
        <div
          aria-expanded={chevron === ChevronDown}
          className={styles.rowToggle}
          role={'button'}
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={rowKeyDownHandler(onToggle)}
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
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={chevron}
            size={15}
            style={{ flex: 'none' }}
          />
        </div>
      </div>
    );
  },
);
LevelRow.displayName = 'AcceptanceLevelRow';

/**
 * The checks a task's acceptance was judged on, read when the level is opened.
 *
 * Loaded on demand on purpose: the hierarchy's counts come from the graph
 * snapshot, so opening one level costs one bundle instead of the page fetching
 * every task's checks up front.
 *
 * No live poll here. This is a detail view inside a summary, and "expand all"
 * mounts one of these per task — the acceptance page's 5s poll would become one
 * interval per opened row. The tallies stay current because they ride the graph
 * poll, and the surface still revalidates on focus/reconnect.
 */
const TaskChecks = memo<{ acceptanceId: string; onOpenCheck: (checkId: string) => void }>(
  ({ acceptanceId, onOpenCheck }) => {
    const { t } = useTranslation(['chat', 'verify']);
    const { data, error, isLoading, mutate } = useAcceptanceBundle(acceptanceId, { poll: false });
    const checks = data?.checks ?? [];

    if (isLoading && !data)
      return (
        <Flexbox className={styles.nestedList} gap={8} paddingBlock={10} paddingInline={12}>
          {[0, 1, 2].map((index) => (
            <Skeleton height={14} key={index} radius={4} width={`${40 + index * 12}%`} />
          ))}
        </Flexbox>
      );

    // A failed read must not read as "this acceptance has no checks".
    if (error)
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.error}
          gap={8}
          justify={'space-between'}
        >
          <Text fontSize={12} style={{ flex: 1 }} type={'danger'}>
            {t('goalProcess.acceptanceHierarchy.checksError')}
          </Text>
          <Button
            icon={<Icon icon={RotateCcw} />}
            size={'small'}
            type={'text'}
            onClick={() => void mutate()}
          >
            {t('goalProcess.acceptanceHierarchy.retry')}
          </Button>
        </Flexbox>
      );

    if (checks.length === 0)
      return <div className={styles.empty}>{t('goalProcess.acceptanceHierarchy.noChecks')}</div>;

    return (
      /* Flat, indented rows — the same grammar as the level rows above. An
         outlined card here put its rounded top corner flush under the level
         row's own separator, so the two lines read as one broken edge. */
      <div className={styles.nestedList}>
        {checks.map((check: AcceptanceCheck) => {
          const meta = checkHeadMeta(check);
          return (
            <CriterionRow
              icon={<Icon color={meta.color} icon={meta.icon} size={16} style={{ flex: 'none' }} />}
              key={check.id}
              seq={check.seq}
              title={checkDisplayTitle(
                check.title,
                t('acceptance.checks.holisticTitle', { ns: 'verify' }),
              )}
              onOpen={() => onOpenCheck(check.id)}
            />
          );
        })}
      </div>
    );
  },
);
TaskChecks.displayName = 'AcceptanceTaskChecks';

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
 * opening in place to the checks it was judged on.
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
    const openAcceptanceCheck = useChatStore((state) => state.openAcceptanceCheck);
    const tallyText = useTallyText();
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const { acceptAll, acceptLevel, awaiting, pendingKey } = useAcceptanceSignOff(
      goalId,
      tree.tasks,
    );

    const toggle = useCallback((key: string) => {
      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }, []);

    const taskKeys = useMemo(() => tree.tasks.map((level) => level.key), [tree]);
    const allExpanded = taskKeys.length > 0 && taskKeys.every((key) => expanded.has(key));

    // No task holds an acceptance: the criteria list already carries the goal's
    // own result, so this group is absent rather than an empty heading.
    if (tree.tasks.length === 0) return null;

    const groupActions =
      (canReview && awaiting.length > 0) || taskKeys.length > 1 ? (
        <Flexbox horizontal align={'center'} gap={4}>
          {canReview && awaiting.length > 0 && (
            <Button
              icon={<Icon icon={CheckCheck} />}
              size={'small'}
              type={'text'}
              onClick={acceptAll}
            >
              {t('goalProcess.acceptanceHierarchy.acceptAll')}
            </Button>
          )}
          {taskKeys.length > 1 && (
            <ActionIcon
              icon={allExpanded ? ChevronsDownUp : ChevronsUpDown}
              size={'small'}
              aria-label={t(
                allExpanded
                  ? 'goalProcess.acceptanceHierarchy.collapseAll'
                  : 'goalProcess.acceptanceHierarchy.expandAll',
              )}
              title={t(
                allExpanded
                  ? 'goalProcess.acceptanceHierarchy.collapseAll'
                  : 'goalProcess.acceptanceHierarchy.expandAll',
              )}
              onClick={() => setExpanded(allExpanded ? new Set() : new Set(taskKeys))}
            />
          )}
        </Flexbox>
      ) : undefined;

    return (
      <Flexbox gap={8}>
        <GroupLabel extra={groupActions}>{t('goalProcess.acceptanceHierarchy.group')}</GroupLabel>
        <Flexbox>
          {tree.tasks.map((level) => (
            <Flexbox key={level.key}>
              <LevelRow
                chevron={expanded.has(level.key) ? ChevronDown : ChevronRight}
                dim={level.state === 'unavailable'}
                meta={tallyText(level.checks)}
                seq={level.node.seq ? `#${level.node.seq}` : undefined}
                state={level.state}
                title={level.node.node.title}
                action={
                  canReview && level.state === 'awaitingSignOff' && level.acceptanceId ? (
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
                        // The sign-off sits inside the row's own expand target;
                        // acting on it must not also fold the level.
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
                onToggle={() => toggle(level.key)}
              />
              {expanded.has(level.key) &&
                (level.acceptanceId ? (
                  <TaskChecks
                    acceptanceId={level.acceptanceId}
                    onOpenCheck={(checkId) => openAcceptanceCheck(level.acceptanceId!, checkId)}
                  />
                ) : (
                  <div className={styles.empty}>
                    {t('goalProcess.acceptanceHierarchy.taskNotDispatched')}
                  </div>
                ))}
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

GoalAcceptanceHierarchy.displayName = 'GoalAcceptanceHierarchy';

export default GoalAcceptanceHierarchy;

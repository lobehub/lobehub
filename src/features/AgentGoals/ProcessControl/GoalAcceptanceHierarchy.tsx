'use client';

import type { VerifyCheckTally } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BadgeCheck,
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
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type AcceptanceCheck,
  checkDisplayTitle,
  checkHeadMeta,
  CriterionList,
  CriterionRow,
  useAcceptanceBundle,
} from '@/features/Acceptance';
import { useChatStore } from '@/store/chat';

import type { AcceptanceLevelState, AcceptanceTree } from './goalAcceptanceTree';

const styles = createStaticStyles(({ css }) => ({
  /* One indentation step per level, carried by the offset alone — a guide rule
     per level would draw three lines for one relationship. */
  row: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 38px;
    padding-block: 8px;
    padding-inline: 12px 6px;
    border: none;

    text-align: start;

    background: none;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowStatic: css`
    cursor: default;

    &:hover {
      background: none;
    }
  `,
  seq: css`
    flex: none;

    min-width: 26px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  title: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  titleStrong: css`
    font-weight: 600;
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
  caption: css`
    padding-block: 14px 2px;
    padding-inline: 12px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  /* Check rows keep the acceptance page's own list grammar, so opening a level
     and opening the acceptance read as the same list. */
  nestedList: css`
    margin-block-end: 4px;
    margin-inline-start: 42px;
  `,
  empty: css`
    padding-block: 10px;
    padding-inline: 42px 12px;
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
  chevron?: typeof ChevronRight;
  dim?: boolean;
  meta?: string;
  onToggle?: () => void;
  seq?: string;
  state: AcceptanceLevelState;
  strong?: boolean;
  title: string;
}

const LevelRow = memo<LevelRowProps>(
  ({ chevron, dim, meta, onToggle, seq, state, strong, title }) => {
    const { t } = useTranslation('chat');
    return (
      <button
        aria-expanded={chevron ? chevron === ChevronDown : undefined}
        className={cx(styles.row, !onToggle && styles.rowStatic)}
        type={'button'}
        onClick={onToggle}
      >
        <Icon
          aria-label={t(LEVEL_LABEL_KEY[state] as any)}
          color={levelColor(state)}
          icon={LEVEL_GLYPH[state]}
          size={16}
          style={{ flex: 'none' }}
        />
        {seq && <span className={styles.seq}>{seq}</span>}
        <span className={cx(styles.title, strong && styles.titleStrong, dim && styles.titleQuiet)}>
          {title}
        </span>
        {meta && <span className={styles.meta}>{meta}</span>}
        {chevron && <Icon color={cssVar.colorTextQuaternary} icon={chevron} size={15} />}
      </button>
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
 */
const TaskChecks = memo<{ acceptanceId: string; onOpenCheck: (checkId: string) => void }>(
  ({ acceptanceId, onOpenCheck }) => {
    const { t } = useTranslation(['chat', 'verify']);
    const { data, error, isLoading, mutate } = useAcceptanceBundle(acceptanceId);
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
      <CriterionList className={styles.nestedList}>
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
      </CriterionList>
    );
  },
);
TaskChecks.displayName = 'AcceptanceTaskChecks';

export interface GoalAcceptanceHierarchyProps {
  tree: AcceptanceTree;
}

/**
 * Every acceptance of a Goal in one place, one level per acceptance, so a
 * delivery can be reviewed top-down instead of opened one task at a time.
 *
 * Reads anything async? No. Every level and every tally rides on the goal graph
 * snapshot the page has already loaded, so this renders with the page instead
 * of adding a second loading state beside it.
 *
 * Three things this deliberately does NOT do:
 *
 * - It does not roll the levels up. A task's acceptance and the goal-level
 *   acceptance are independent judgments, so each level shows its OWN state and
 *   the caption says so; deriving a parent from its children would state a rule
 *   the product never decided, and could contradict the header above it.
 * - It does not count a level the server did not count. A level with no round
 *   yet shows no tally rather than a row of zeroes.
 * - It does not restate the goal-level criteria. That list, with its per-check
 *   evidence and reasons, is its own section on this page; the goal level here
 *   is the anchor the task levels hang from, not a second copy of it.
 */
const GoalAcceptanceHierarchy = memo<GoalAcceptanceHierarchyProps>(({ tree }) => {
  const { t } = useTranslation('chat');
  const openAcceptanceCheck = useChatStore((state) => state.openAcceptanceCheck);
  const tallyText = useTallyText();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

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

  const { goal } = tree;
  // A goal whose acceptance has not been dispatched yet has nothing to anchor
  // the task levels to, and an empty list would read as "nothing to review".
  if (!goal && tree.tasks.length === 0) return null;

  return (
    <Flexbox>
      <Flexbox horizontal align={'center'} gap={8} paddingInline={12}>
        <Text fontSize={13} weight={600}>
          {t('goalProcess.acceptanceHierarchy.title')}
        </Text>
        <Flexbox flex={1} />
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

      {goal && (
        <div style={{ paddingBlockStart: 6 }}>
          <LevelRow
            strong
            meta={tallyText(goal.checks)}
            state={goal.state}
            title={t('goalProcess.acceptanceHierarchy.goalLevel')}
          />
        </div>
      )}

      {tree.tasks.length > 0 && (
        <>
          {/* The two levels are judged separately, and the tree must not imply
              otherwise — a parent that passed does not vouch for its children. */}
          <div className={styles.caption}>{t('goalProcess.acceptanceHierarchy.taskCaption')}</div>
          {tree.tasks.map((level) => (
            <Flexbox key={level.key}>
              <LevelRow
                chevron={expanded.has(level.key) ? ChevronDown : ChevronRight}
                dim={level.state === 'unavailable'}
                meta={tallyText(level.checks)}
                seq={level.node.seq ? `#${level.node.seq}` : undefined}
                state={level.state}
                title={level.node.node.title}
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
        </>
      )}
    </Flexbox>
  );
});

GoalAcceptanceHierarchy.displayName = 'GoalAcceptanceHierarchy';

export default GoalAcceptanceHierarchy;

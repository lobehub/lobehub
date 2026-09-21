'use client';

import { isDraftVerifyRun } from '@lobechat/const/verify';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Select, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useSingleton } from '@/hooks/useSingleton';
import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { hasVisualEvidence } from '../Evidence/evidence';
import AcceptanceInteractionCost from '../History/AcceptanceInteractionCost';
import { acceptanceCheckPath } from '../routes';
import { checksForTurn } from '../turnChecks';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useAcceptanceTurn } from '../useAcceptanceTurn';
import { canReviewAcceptance } from '../visibility';
import CheckList from './CheckList';
import {
  type CheckFilter,
  checkFilterState,
  groupChecks,
  isException,
  isGroupFullyAccepted,
  shouldGroupChecks,
  userReviewState,
} from './checkState';
import { EMPTY_ID_SET, setAggregateEntry } from './expandState';

const styles = createStaticStyles(({ css }) => ({
  filters: css`
    @media (width <= 767px) {
      width: 100%;
    }
  `,
  filterSelect: css`
    width: 118px;

    @media (width <= 767px) {
      flex: 1;
      width: 0;
      min-width: 0;
    }
  `,
  toolbarHeading: css`
    @media (width <= 767px) {
      flex-basis: 100%;
    }
  `,
}));

interface AcceptanceCheckInventoryProps {
  children?: ReactNode;
  onOpenTrace?: (verifierOperationId: string) => void | Promise<void>;
  toolbar?: ReactNode;
}

const AcceptanceCheckInventory = ({
  children,
  onOpenTrace,
  toolbar,
}: AcceptanceCheckInventoryProps) => {
  const { t } = useTranslation('verify');
  const { md = true } = useResponsive();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [localFilter, setLocalFilter] = useState<CheckFilter>('all');
  const urlFilterRaw = searchParams.get('filter');
  const urlFilter: CheckFilter = (
    ['all', 'pending', 'needsFix', 'accepted', 'ignored'] as const
  ).includes(urlFilterRaw as CheckFilter)
    ? (urlFilterRaw as CheckFilter)
    : 'all';
  const filter = embedded ? localFilter : urlFilter;
  const setFilter = (next: CheckFilter) => {
    if (embedded) {
      setLocalFilter(next);
      return;
    }
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'all') params.delete('filter');
        else params.set('filter', next);
        return params;
      },
      { replace: true },
    );
  };
  const { turn: roundFilter, setTurn: setRoundFilter } = useAcceptanceTurn(embedded);
  const [expandedById, setExpandedById] = useState<Map<string, Set<string>>>(() => new Map());
  const [collapsedById, setCollapsedById] = useState<Map<string, Set<string>>>(() => new Map());
  const expanded = expandedById.get(acceptanceId) ?? EMPTY_ID_SET;
  const collapsedGroups = collapsedById.get(acceptanceId) ?? EMPTY_ID_SET;
  const setExpanded = useCallback(
    (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
      setExpandedById((map) => setAggregateEntry(map, acceptanceId, update)),
    [acceptanceId],
  );
  const setCollapsedGroups = useCallback(
    (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
      setCollapsedById((map) => setAggregateEntry(map, acceptanceId, update)),
    [acceptanceId],
  );
  const seededIds = useSingleton(() => new Set<string>());

  useEffect(() => {
    if (!data || data.checks.length === 0) return;
    if (seededIds.has(acceptanceId)) return;
    seededIds.add(acceptanceId);
    setExpanded(
      new Set(
        data.checks
          .filter(
            (check) =>
              window.matchMedia('(min-width: 768px)').matches &&
              userReviewState(check) !== 'accepted' &&
              (isException(check) || hasVisualEvidence(check)),
          )
          .map((check) => check.id),
      ),
    );
    setCollapsedGroups(
      shouldGroupChecks(data.checks.length)
        ? new Set(
            groupChecks(data.checks, t('acceptance.group.uncategorized'))
              .filter((group) => isGroupFullyAccepted(group.checks))
              .map((group) => group.key),
          )
        : new Set(),
    );
    const defaultFilter: CheckFilter = data.rounds.length > 1 ? 'pending' : 'all';
    if (embedded) {
      setLocalFilter(defaultFilter);
    } else if (!urlFilterRaw && !roundFilter && defaultFilter !== 'all') {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('filter', defaultFilter);
          return params;
        },
        { replace: true },
      );
    }
  }, [
    acceptanceId,
    data,
    embedded,
    seededIds,
    setCollapsedGroups,
    setExpanded,
    setSearchParams,
    t,
    urlFilterRaw,
    roundFilter,
    md,
  ]);

  if (!data) return null;

  const canReview =
    canReviewAcceptance(data) &&
    (roundFilter === null || roundFilter === data.rounds.at(-1)?.run.roundIndex);
  const checks = checksForTurn(data, roundFilter);

  /**
   * Every mutation the checklist fires goes through here.
   *
   * A rejected promise handed back to CheckList would escape as an unhandled
   * rejection AND strand the row's own pending flag — the row that raised it
   * spins forever, with the reason only in the console. Failing loudly and
   * returning `false` lets the row settle and say what happened.
   */
  const runReviewMutation = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await mutate();
      void globalMutate(isAcceptanceListKey);
      return true;
    } catch (cause) {
      console.error('[acceptance:review]', cause);
      toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
      return false;
    }
  };
  const counts = {
    accepted: checks.filter((check) => checkFilterState(check) === 'accepted').length,
    ignored: checks.filter((check) => checkFilterState(check) === 'ignored').length,
    needsFix: checks.filter((check) => checkFilterState(check) === 'needsFix').length,
    pending: checks.filter((check) => checkFilterState(check) === 'pending').length,
    total: checks.length,
  };
  // On a phone a check opens its own page: the inline disclosure carries a
  // whole evidence review, and unfolding it inside the list buries the rows
  // around it. Pushed (not replaced) so the system back button returns to the
  // list, and flagged so the page's own back arrow can honour that entry.
  // An embedded drawer has no route of its own, so it keeps disclosing.
  const openCheckPage =
    !md && !embedded
      ? (id: string) =>
          navigate(
            acceptanceCheckPath(acceptanceId, id) + (searchParams.size ? `?${searchParams}` : ''),
            {
              state: { fromCheckList: true },
            },
          )
      : undefined;

  const grouped = shouldGroupChecks(checks.length);
  const groupKeys = grouped
    ? groupChecks(checks, t('acceptance.group.uncategorized')).map((group) => group.key)
    : [];
  const allGroupsCollapsed =
    groupKeys.length > 0 && groupKeys.every((key) => collapsedGroups.has(key));
  const groupFeedback = data.rounds.flatMap((round) =>
    (round.run.decisionDetail?.groupFeedback ?? []).map((entry) => ({
      ...entry,
      roundIndex: round.run.roundIndex ?? 0,
    })),
  );
  const currentRound = data.rounds.at(-1)?.run.roundIndex ?? 0;

  return (
    <>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <Flexbox horizontal align={'center'} className={styles.toolbarHeading} flex={1} gap={8}>
          <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
            {t('acceptance.checks.title')}
          </Text>
          <Flexbox flex={1} />
          {toolbar}
        </Flexbox>
        <Flexbox horizontal align={'center'} className={styles.filters} gap={8}>
          <Select
            className={styles.filterSelect}
            value={filter}
            variant={'filled'}
            options={[
              { label: t('acceptance.filter.all', { count: counts.total }), value: 'all' },
              {
                label: t('acceptance.filter.pending', { count: counts.pending }),
                value: 'pending',
              },
              {
                label: t('acceptance.filter.needsFix', { count: counts.needsFix }),
                value: 'needsFix',
              },
              {
                label: t('acceptance.filter.accepted', { count: counts.accepted }),
                value: 'accepted',
              },
              {
                label: t('acceptance.filter.ignored', { count: counts.ignored }),
                value: 'ignored',
              },
            ]}
            onChange={(value) => setFilter(value as CheckFilter)}
          />
          {data.rounds.length > 1 && (
            <Select
              className={styles.filterSelect}
              value={roundFilter === null ? 'all' : String(roundFilter)}
              variant={'filled'}
              options={[
                { label: t('acceptance.filter.roundAll'), value: 'all' },
                ...[...data.rounds].reverse().map((round) => ({
                  label: isDraftVerifyRun(round.run)
                    ? t('flow.pendingPlan')
                    : t('acceptance.round', { round: round.run.roundIndex }),
                  value: String(round.run.roundIndex),
                })),
              ]}
              onChange={(value) => setRoundFilter(value === 'all' ? null : Number(value))}
            />
          )}
          {grouped && (
            <ActionIcon
              icon={allGroupsCollapsed ? ChevronsUpDown : ChevronsDownUp}
              size={'small'}
              title={
                allGroupsCollapsed
                  ? t('acceptance.group.expandAll')
                  : t('acceptance.group.collapseAll')
              }
              onClick={() =>
                setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(groupKeys))
              }
            />
          )}
        </Flexbox>
      </Flexbox>
      {children}
      <CheckList
        canReview={canReview}
        checks={checks}
        collapsedGroups={collapsedGroups}
        currentRound={currentRound}
        expanded={expanded}
        filter={filter}
        groupFeedback={groupFeedback}
        reviewPending={false}
        onOpenCheck={openCheckPage}
        onOpenTrace={onOpenTrace}
        onRound={setRoundFilter}
        onDismissProposal={
          canReview
            ? async (input) => {
                await runReviewMutation(() =>
                  verifyService.adjudicateProposal({
                    adjudication: input.adjudication,
                    id: data.acceptance.id,
                    predictionId: input.predictionId,
                  }),
                );
              }
            : undefined
        }
        onGroupFeedback={async (category, comment, fileIds) => {
          if (!canReview) return false;
          return runReviewMutation(() =>
            verifyService.addGroupFeedback({
              category,
              comment,
              fileIds: fileIds.length > 0 ? fileIds : undefined,
              id: data.acceptance.id,
            }),
          );
        }}
        onReview={async (input) => {
          if (!canReview) return false;
          return runReviewMutation(() =>
            verifyService.reviewChecks({ id: data.acceptance.id, ...input }),
          );
        }}
        onToggleGroup={(key) =>
          setCollapsedGroups((previous) => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        onToggleGroupItems={(ids, open) =>
          setExpanded((previous) => {
            const next = new Set(previous);
            for (const id of ids) {
              if (open) next.add(id);
              else next.delete(id);
            }
            return next;
          })
        }
        onToggleItem={(id) =>
          setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
      {/* After the list, never inside it: the checks are the decision surface,
          and a row sitting among them reads as one more thing to review. */}
      <AcceptanceInteractionCost data={data} />
    </>
  );
};

export default AcceptanceCheckInventory;

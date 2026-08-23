'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useSingleton } from '@/hooks/useSingleton';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from './AcceptanceScope';
import CheckList, {
  type CheckFilter,
  checkFilterState,
  groupChecks,
  hasVisualEvidence,
  isException,
  isGroupFullyAccepted,
  shouldGroupChecks,
  userReviewState,
} from './CheckList';
import { EMPTY_ID_SET, setAggregateEntry } from './expandState';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const styles = createStaticStyles(({ css }) => ({
  countBadge: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 99px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface AcceptanceCheckInventoryProps {
  canReview?: boolean;
  children?: ReactNode;
  onOpenTrace?: (verifierOperationId: string) => void | Promise<void>;
  toolbar?: ReactNode;
}

const AcceptanceCheckInventory = ({
  canReview = false,
  children,
  onOpenTrace,
  toolbar,
}: AcceptanceCheckInventoryProps) => {
  const { t } = useTranslation('verify');
  const { lg = true } = useResponsive();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const compactToolbar = embedded || !lg;
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
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
  const [roundFilter, setRoundFilter] = useState<number | null>(null);
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
    } else if (!urlFilterRaw && defaultFilter !== 'all') {
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
  ]);

  if (!data) return null;

  const checks = data.checks;
  const counts = {
    accepted: checks.filter((check) => checkFilterState(check) === 'accepted').length,
    ignored: checks.filter((check) => checkFilterState(check) === 'ignored').length,
    needsFix: checks.filter((check) => checkFilterState(check) === 'needsFix').length,
    pending: checks.filter((check) => checkFilterState(check) === 'pending').length,
    total: checks.length,
  };
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
      <Flexbox horizontal align={'center'} gap={8} wrap={compactToolbar ? 'nowrap' : 'wrap'}>
        <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
          {t('acceptance.checks.title')}
        </Text>
        <span className={styles.countBadge}>{counts.total}</span>
        <Flexbox flex={1} />
        {toolbar}
        <Select
          size={'small'}
          style={{ height: 34, width: 118 }}
          value={filter}
          variant={'filled'}
          options={[
            { label: t('acceptance.filter.all', { count: counts.total }), value: 'all' },
            { label: t('acceptance.filter.pending', { count: counts.pending }), value: 'pending' },
            {
              label: t('acceptance.filter.needsFix', { count: counts.needsFix }),
              value: 'needsFix',
            },
            {
              label: t('acceptance.filter.accepted', { count: counts.accepted }),
              value: 'accepted',
            },
            { label: t('acceptance.filter.ignored', { count: counts.ignored }), value: 'ignored' },
          ]}
          onChange={(value) => setFilter(value as CheckFilter)}
        />
        {data.rounds.length > 1 && canReview && (
          <Select
            size={'small'}
            style={{ height: 34, width: 110 }}
            value={roundFilter === null ? 'all' : String(roundFilter)}
            variant={'filled'}
            options={[
              { label: t('acceptance.filter.roundAll'), value: 'all' },
              ...[...data.rounds].reverse().map((round) => ({
                label: t('acceptance.round', { round: round.run.roundIndex }),
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
            onClick={() => setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(groupKeys))}
          />
        )}
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
        round={roundFilter}
        onOpenTrace={onOpenTrace}
        onDismissProposal={
          canReview
            ? async (input) => {
                await verifyService.adjudicateProposal({
                  adjudication: input.adjudication,
                  id: data.acceptance.id,
                  predictionId: input.predictionId,
                });
                await mutate();
                void globalMutate(verifyKeys.acceptances());
              }
            : undefined
        }
        onGroupFeedback={async (category, comment, fileIds) => {
          if (!canReview) return false;
          await verifyService.addGroupFeedback({
            category,
            comment,
            fileIds: fileIds.length > 0 ? fileIds : undefined,
            id: data.acceptance.id,
          });
          await mutate();
          void globalMutate(verifyKeys.acceptances());
          return true;
        }}
        onReview={async (input) => {
          if (!canReview) return false;
          await verifyService.reviewChecks({ id: data.acceptance.id, ...input });
          await mutate();
          void globalMutate(verifyKeys.acceptances());
          return true;
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
    </>
  );
};

export default AcceptanceCheckInventory;

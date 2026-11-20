'use client';

import { isDraftVerifyRun } from '@lobechat/const/verify';
import { ActionIcon, Flexbox, Select, toast, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { use, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { verifyService } from '@/services/verify';
import { useVerifyStore } from '@/store/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { hasVisualEvidence } from '../Evidence/evidence';
import AcceptanceInteractionCost from '../History/AcceptanceInteractionCost';
import { RunsPanelContext } from '../History/runsPanel';
import { acceptanceCheckPath, useAcceptanceRouteBase } from '../routes';
import { checksForTurn } from '../turnChecks';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useAcceptanceTurn } from '../useAcceptanceTurn';
import { canReviewAcceptance, canViewAcceptanceHistory } from '../visibility';
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
import { collectGroupFeedback } from './readPresentation';

const FILTER_TABS = [
  { key: 'pending', labelKey: 'acceptance.focus.state.pending' },
  { key: 'needsFix', labelKey: 'acceptance.focus.state.needsFix' },
  { key: 'accepted', labelKey: 'acceptance.focus.state.accepted' },
  { key: 'ignored', labelKey: 'acceptance.focus.state.ignored' },
  { key: 'all', labelKey: 'acceptance.filter.allLabel' },
] as const;

const styles = stylex.create({
  filters: { width: { 'default': null, '@media (width <= 767px)': '100%' } },
  filterTabs: {
    display: 'flex',
    flex: '1',
    gap: '4px',
    alignItems: 'center',
    minWidth: 0,
    overflowX: 'auto',
    scrollbarWidth: 'none',
  },
  filterTab: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    height: '28px',
    margin: 0,
    paddingBlock: 0,
    paddingInline: '8px',
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: '6px',
    font: 'inherit',
    fontSize: '14px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    outlineWidth: { 'default': 0, ':focus-visible': '2px' },
    outlineStyle: { 'default': 'none', ':focus-visible': 'solid' },
    outlineColor: cssVar.colorPrimary,
    outlineOffset: '2px',
  },
  filterTabActive: {
    fontWeight: 500,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  filterCount: {
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 400,
    color: cssVar.colorTextTertiary,
  },
  filterSelect: {
    width: { 'default': '118px', '@media (width <= 767px)': '0' },
    flex: { 'default': null, '@media (width <= 767px)': '1' },
    minWidth: { 'default': null, '@media (width <= 767px)': '0' },
  },
  toolbarHeading: { flexBasis: { 'default': null, '@media (width <= 767px)': '100%' } },
});

interface AcceptanceCheckInventoryProps {
  children?: ReactNode;
  onOpenTrace?: (verifierOperationId: string) => void | Promise<void>;
  /** Rides right after the title — a host's word on where the delivery stands. */
  titleExtra?: ReactNode;
  toolbar?: ReactNode;
}

const AcceptanceCheckInventory = ({
  children,
  onOpenTrace,
  titleExtra,
  toolbar,
}: AcceptanceCheckInventoryProps) => {
  const { t } = useTranslation('verify');
  const { md = true } = useResponsive();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const routeBase = useAcceptanceRouteBase();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const navigate = useWorkspaceAwareNavigate();
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
  const [seededIds, setSeededIds] = useState<ReadonlySet<string>>(() => new Set());
  const [urlSeed, setUrlSeed] = useState<{ acceptanceId: string; filter: CheckFilter }>();

  const seedChecks = data?.checks ?? [];
  if (data && seedChecks.length > 0 && !seededIds.has(acceptanceId)) {
    setSeededIds(new Set(seededIds).add(acceptanceId));
    setExpanded(
      new Set(
        seedChecks
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
      shouldGroupChecks(seedChecks.length)
        ? new Set(
            groupChecks(seedChecks, t('acceptance.group.uncategorized'))
              .filter((group) => isGroupFullyAccepted(group.checks))
              .map((group) => group.key),
          )
        : new Set(),
    );
    const defaultFilter: CheckFilter = (data.rounds ?? []).length > 1 ? 'pending' : 'all';
    if (embedded) {
      setLocalFilter(defaultFilter);
    } else if (!urlFilterRaw && !roundFilter && defaultFilter !== 'all') {
      setUrlSeed({ acceptanceId, filter: defaultFilter });
    }
  }

  useEffect(() => {
    if (!urlSeed) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('filter', urlSeed.filter);
        return params;
      },
      { replace: true },
    );
  }, [setSearchParams, urlSeed]);

  if (!data) return null;

  const hasRunsPanel = use(RunsPanelContext);
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
      void useVerifyStore.getState().refreshAcceptanceLists();
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
            acceptanceCheckPath(acceptanceId, id, routeBase) +
              (searchParams.size ? `?${searchParams}` : ''),
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
  const groupFeedback = collectGroupFeedback(data.rounds);
  const currentRound = data.rounds.at(-1)?.run.roundIndex ?? 0;

  return (
    <>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.toolbarHeading).className}
          flex={1}
          gap={8}
        >
          <div
            aria-label={t('acceptance.checks.title')}
            role={'group'}
            {...stylex.props(styles.filterTabs)}
          >
            {FILTER_TABS.map(({ key, labelKey }) => (
              <button
                aria-pressed={filter === key}
                key={key}
                type={'button'}
                {...stylex.props(styles.filterTab, filter === key && styles.filterTabActive)}
                onClick={() => setFilter(key)}
              >
                {t(labelKey)}
                <span {...stylex.props(styles.filterCount)}>
                  {key === 'all' ? counts.total : counts[key]}
                </span>
              </button>
            ))}
          </div>
          {titleExtra}
          {toolbar}
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.filters).className}
          gap={8}
        >
          {data.rounds.length > 1 && (
            <Select
              className={stylex.props(styles.filterSelect).className}
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
        onShowAll={() => setFilter('all')}
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
          and a row sitting among them reads as one more thing to review. Whoever
          can open the Runs panel already reads the cost there; a host that
          mounts the inventory alone has no such panel. */}
      {!(hasRunsPanel && canViewAcceptanceHistory(data.isOwner)) && (
        <AcceptanceInteractionCost data={data} />
      )}
    </>
  );
};

export default AcceptanceCheckInventory;

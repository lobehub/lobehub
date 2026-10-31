'use client';

import type { DraggablePanelProps, DropdownItem } from '@lobehub/ui';
import {
  Accordion,
  ActionIcon,
  Button,
  Center,
  Checkbox,
  DraggablePanel,
  DraggablePanelContainer,
  DropdownMenu,
  Empty,
  Flexbox,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useDebounce } from 'ahooks';
import isEqual from 'fast-deep-equal';
import {
  ArrowLeft,
  CircleDashed,
  FolderClosed,
  ListChecks,
  ListFilter,
  MoreHorizontal,
  PanelLeftClose,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import type { AcceptanceStatusOverride } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useVerifyStore } from '@/store/verify';
import { sx } from '@/styles/sx';

import { useAcceptanceList, useAcceptanceListInfinite } from '../hooks';
import { acceptanceHomePath, useAcceptanceRouteBase } from '../Viewer/routes';
import type { AcceptanceStatusAction } from '../Viewer/statusActions';
import AcceptanceBatchBar from './AcceptanceBatchBar';
import { openAcceptanceDeleteConfirm } from './AcceptanceDeleteConfirm';
import {
  acceptanceListEmptyVariant,
  type AcceptanceListFacets,
  type AcceptanceListFilter,
  acceptanceProjectScopeKey,
  DEFAULT_ACCEPTANCE_LIST_FACETS,
  DEFAULT_ACCEPTANCE_LIST_FILTER,
  effectiveAcceptanceListFacets,
  isAcceptanceListFacetsNarrowed,
  normalizeAcceptanceListFacets,
  normalizeAcceptanceListFilter,
  resetAcceptanceListFacets,
} from './acceptanceListFilter';
import AcceptanceRow from './AcceptanceRow';
import AcceptanceScopeSwitcher from './AcceptanceScopeSwitcher';
import {
  acceptanceBatchTargets,
  acceptanceProjectTargets,
  acceptanceRedirectAfterDelete,
  acceptanceSelectAllState,
  chunkAcceptanceBatch,
  nextAcceptanceSelectAll,
  rangeAcceptanceSelection,
  toggleAcceptanceSelection,
  visibleAcceptanceSelection,
} from './batchSelection';
import {
  type AcceptanceGroupMode,
  DEFAULT_ACCEPTANCE_GROUP_MODE,
  expandedAcceptanceGroupKeys,
  groupAcceptanceList,
  nextCollapsedGroupKeys,
  resolveAcceptanceGroupMode,
  shouldRenderAcceptanceGroups,
} from './groupAcceptanceList';
import { useAcceptanceListFilterMenu } from './useAcceptanceListFilterMenu';
import type { ReportPanelExpand } from './useReportPanelExpand';

const PANEL_MIN = 260;
const PANEL_MAX = 420;
const ACCEPTANCE_LIST_FILTER_STORAGE_KEY = 'lobehub-acceptance-list-filter';
const ACCEPTANCE_LIST_FACETS_STORAGE_KEY = 'lobehub-acceptance-list-facets';
const ACCEPTANCE_GROUP_MODE_STORAGE_KEY = 'lobehub-acceptance-group-mode';
/** Pull the next page before the sentinel is actually on screen. */
const LOAD_MORE_ROOT_MARGIN = '240px';
type BatchSuccessKey =
  | 'acceptance.workspace.batch.deleteSuccess'
  | 'acceptance.workspace.batch.projectRemoveSuccess'
  | 'acceptance.workspace.batch.projectSuccess'
  | 'acceptance.workspace.batch.statusSuccess';
const EMPTY_FILTER_KEYS = {
  active: 'acceptance.workspace.filters.empty.active',
  completed: 'acceptance.workspace.filters.empty.completed',
} as const satisfies Record<Exclude<AcceptanceListFilter, 'all'>, string>;

const styles = stylex.create({
  panel: {
    height: '100%',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  head: {
    flex: 'none',
    paddingBlockStart: '14px',
    paddingBlockEnd: '6px',
    paddingInline: '12px',
  },
  headWithBrand: {
    flex: 'none',
    paddingBlockStart: 0,
    paddingBlockEnd: '6px',
    paddingInline: '12px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInline: '4px',
  },
  titleRowWithBrand: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '48px',
    paddingInline: '4px',
  },
  collapseBtn: {
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    borderStyle: 'none',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  search: {
    display: 'flex',
    gap: '7px',
    alignItems: 'center',
    /* The only child label of the search row: it takes the row's free width. */
    flex: '1',
    minWidth: '0',
    height: '32px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  searchIcon: { flex: 'none', color: cssVar.colorTextQuaternary },
  searchInput: {
    'width': '100%',
    'minWidth': '0',
    'borderStyle': 'none',
    'fontSize': '13px',
    'color': cssVar.colorText,
    'backgroundColor': 'transparent',
    'backgroundImage': 'none',
    'outline': 'none',
    '::placeholder': { color: cssVar.colorTextQuaternary },
  },
  searchRow: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    marginBlockStart: '8px',
    marginBlockEnd: '4px',
    marginInline: '4px',
  },
  filterButton: { flex: 'none' },
  selectionRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBlockStart: '2px',
    marginBlockEnd: '4px',
    marginInline: '4px',
    fontSize: '12px',
  },
  searchEmpty: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    alignItems: 'flex-start',
    paddingBlock: '24px',
    paddingInline: '12px',
  },
  searchEmptyMsg: {
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextTertiary,
    wordBreak: 'break-word',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    paddingBlockStart: '6px',
    paddingBlockEnd: '16px',
    paddingInline: '8px',
  },
  groupList: { display: 'flex', flexDirection: 'column', gap: '2px' },
  groupTitle: {
    display: 'inline-flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '14px',
    color: cssVar.colorTextSecondary,
  },
  emptyState: {
    height: '100%',
    minHeight: '240px',
    paddingBlock: '24px',
    paddingInline: '16px',
  },
  retryBtn: {
    cursor: 'pointer',
    paddingBlock: '4px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorTextTertiary },
    borderRadius: '4px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

interface AcceptanceListPanelProps extends ReportPanelExpand {
  headerLeading?: ReactNode;
  /**
   * Rendered inside a host that already supplies the collection title and the
   * way to dismiss it (the shell top bar plus its drawer). Drops the panel's
   * own resizable frame and title row so the title is not stated twice.
   */
  hosted?: boolean;
  /**
   * The per-project entries, as MENU ITEMS. Injected by the main app rather
   * than imported here: they open the create-project modal and navigate to
   * `/project/:id`, neither of which exists in the standalone workbench app —
   * and a direct import would drag the project store into its bundle. The menu
   * chrome stays here so the header can carry ONE overflow menu for everything
   * it offers, the multi-select toggle included.
   */
  projectActionItems?: (projectId?: string) => DropdownItem[];
  projectId?: string;
}

/**
 * Master list of the caller's acceptance aggregates — the acceptance twin of
 * the verify workspace's ReportListPanel, sharing its visual language and the
 * same persisted panel-width preference so the two surfaces read as one family.
 */
const AcceptanceListPanel = memo<AcceptanceListPanelProps>(
  ({ expand, headerLeading, hosted, isNarrow, projectActionItems, projectId, setExpand }) => {
    const { t } = useTranslation('verify');
    const navigate = useWorkspaceAwareNavigate();
    const routeBase = useAcceptanceRouteBase();
    const { acceptanceId } = useParams<{ acceptanceId: string }>();

    const [query, setQuery] = useState('');
    const [storedFilter, setStoredFilter] = useLocalStorageState<AcceptanceListFilter>(
      ACCEPTANCE_LIST_FILTER_STORAGE_KEY,
      DEFAULT_ACCEPTANCE_LIST_FILTER,
    );
    // Collapsed (not expanded) is the tracked set: a group that appears after
    // mount — the project a delivery was just filed into — must come in open.
    const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
    const [storedGroupMode, setStoredGroupMode] = useLocalStorageState<AcceptanceGroupMode>(
      ACCEPTANCE_GROUP_MODE_STORAGE_KEY,
      DEFAULT_ACCEPTANCE_GROUP_MODE,
    );
    const [storedFacets, setStoredFacets] = useLocalStorageState<AcceptanceListFacets>(
      ACCEPTANCE_LIST_FACETS_STORAGE_KEY,
      DEFAULT_ACCEPTANCE_LIST_FACETS,
    );
    const filter = normalizeAcceptanceListFilter(storedFilter);
    // A project choice is only meaningful in the workspace it was made in.
    const workspaceId = useActiveWorkspaceId();
    const facets = normalizeAcceptanceListFacets(
      storedFacets,
      acceptanceProjectScopeKey(workspaceId),
    );
    const facetsNarrowed = isAcceptanceListFacetsNarrowed(facets, projectId);
    const {
      projectId: listProjectId,
      scope,
      source,
    } = effectiveAcceptanceListFacets(facets, projectId);
    const listQuery = { projectId: listProjectId, scope, source };
    const groupMode = resolveAcceptanceGroupMode(storedGroupMode, projectId);
    const debouncedQuery = useDebounce(query.trim(), { wait: 300 });
    const trimmedQuery = query.trim();
    const searching = Boolean(debouncedQuery);

    // Two feeds, one at a time. Browsing scrolls a keyset-paged feed; searching
    // hands off to the flat read, which resolves every subject title across the
    // WHOLE owned set — a paged search would only ever match what had scrolled
    // in, and would report an exhausted list while the match sat on page four.
    const search = useAcceptanceList(searching, {
      ...listQuery,
      filter,
      q: debouncedQuery || undefined,
    });
    const {
      hasMore,
      isLoadingInitial,
      isLoadingMore,
      items: pagedItems,
      loadMore,
      ...pagedRest
    } = useAcceptanceListInfinite(searching ? null : filter, listQuery);

    const items = searching ? (search.data ?? []) : pagedItems;
    const error = searching ? search.error : pagedRest.error;
    const isLoading = searching ? search.isLoading : isLoadingInitial;
    const mutate = searching ? search.mutate : pagedRest.mutate;

    // Deduped against the workspace shell's own `filter: 'all'` read, so this
    // probe costs no extra request — it only answers whether a zero-result
    // filter is hiding anything at all (see acceptanceListEmptyVariant).
    const allProbe = useAcceptanceList(!error && !isLoading && items.length === 0, {
      filter: 'all',
      projectId,
    });
    const emptyVariant = acceptanceListEmptyVariant({
      allListEmpty: allProbe.data ? allProbe.data.length === 0 : undefined,
      facetsNarrowed,
      filter,
      searching: Boolean(trimmedQuery),
    });

    const groups = groupAcceptanceList(items, groupMode);
    const showGroups = shouldRenderAcceptanceGroups(groupMode, groups);

    // Auto-load the next page as the sentinel nears the viewport.
    //
    // The sentinel node is STATE, not a ref: on first paint the list is still a
    // skeleton, so a ref would be null when the effect runs — and since none of
    // `hasMore` / `isLoadingMore` / `loadMore` changes when the rows finally
    // replace the skeleton, the effect would never re-run and the observer
    // would never attach. Scrolling to the bottom then loads nothing, silently.
    const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
    const autoLoad = !searching && hasMore;
    useEffect(() => {
      // Re-created once each page settles, so a reader already parked at the
      // bottom keeps pulling instead of stalling on a no-longer-firing observer.
      if (!sentinel || !autoLoad || isLoadingMore) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) loadMore();
        },
        { rootMargin: LOAD_MORE_ROOT_MARGIN },
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    }, [autoLoad, isLoadingMore, loadMore, sentinel]);

    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [anchorId, setAnchorId] = useState<string | null>(null);
    const [batchPending, setBatchPending] = useState(false);
    // Someone else's acceptance (a participated row) cannot be swept: the
    // batch writes would refuse it, so it never enters the selection at all.
    const selectableItems = items.filter((item) => item.canManage);
    const selectedVisible = visibleAcceptanceSelection(selected, selectableItems);
    const selectAllState = acceptanceSelectAllState(selectableItems.length, selectedVisible.length);

    const leaveSelecting = () => {
      setSelecting(false);
      setSelected([]);
      setAnchorId(null);
    };

    /**
     * Re-read the list, refresh the bundles the sweep touched, and leave the
     * rows that did NOT move selected — a partial sweep hands back exactly the
     * remainder to retry instead of making the user re-pick it.
     *
     * `attemptedIds` is what the sweep actually acted on, which is only ever the
     * VISIBLE selection. Picks the user made under another filter were never
     * attempted, so they survive untouched — dropping them here would contradict
     * the rule that clearing the filter brings earlier picks back.
     */
    const settleBatch = async (
      attemptedIds: string[],
      changedIds: string[],
      failedIds: string[],
    ) => {
      await mutate();
      await Promise.all(
        changedIds.map((id) => useVerifyStore.getState().refreshAcceptanceBundle(id)),
      );

      const attempted = new Set(attemptedIds);
      let remaining: string[] = [];
      setSelected((previous) => {
        remaining = [...previous.filter((id) => !attempted.has(id)), ...failedIds];
        return remaining;
      });
      // Only a sweep that leaves nothing selected at all is finished.
      if (remaining.length === 0) setSelecting(false);
    };

    // "Unchanged" covers both halves of a mixed sweep — rows the transition
    // could not take, and rows the server refused — because to the reviewer
    // they mean the same thing: that one did not move.
    const reportBatch = (changed: number, attempted: number, successKey: BatchSuccessKey) => {
      const unchanged = attempted - changed;
      if (unchanged > 0) {
        toast.warning({
          title: t('acceptance.workspace.batch.partial', { count: changed, failed: unchanged }),
        });
        return;
      }
      toast.success(t(successKey, { count: changed }));
    };

    const sweepStatus = async (
      action: AcceptanceStatusAction,
      status: AcceptanceStatusOverride,
    ) => {
      // Only the rows the transition can actually move — an accepted delivery
      // cannot be accepted twice, and a running one is not decidable at all.
      const targets = acceptanceBatchTargets(items, selectedVisible, action);
      if (targets.length === 0) return;

      const attempted = selectedVisible.length;
      setBatchPending(true);
      try {
        // The endpoint caps one request, so a long selection goes in chunks —
        // otherwise select-all after enough scrolling is refused wholesale and
        // nothing moves at all.
        //
        // `allSettled`, never `all`: a sibling chunk that rejects must not hide
        // the chunks that already committed. Skipping the refresh there would
        // leave the list showing rows the server has already moved.
        const chunks = chunkAcceptanceBatch(targets);
        const settled = await Promise.allSettled(
          chunks.map((chunk) => verifyService.updateAcceptanceStatusBatch(chunk, status)),
        );

        let updated = 0;
        const failedIds: string[] = [];
        settled.forEach((part, index) => {
          if (part.status === 'fulfilled') {
            updated += part.value.updated;
            failedIds.push(...part.value.failedIds);
            return;
          }
          // A chunk that never reached the server: every id in it is unchanged.
          console.error('[acceptance:batchStatus]', part.reason);
          failedIds.push(...chunks[index]);
        });

        const failedSet = new Set(failedIds);
        await settleBatch(
          selectedVisible,
          targets.filter((id) => !failedSet.has(id)),
          selectedVisible.filter((id) => !targets.includes(id) || failedSet.has(id)),
        );
        reportBatch(updated, attempted, 'acceptance.workspace.batch.statusSuccess');
      } catch (cause) {
        console.error('[acceptance:batchStatus]', cause);
        toast.error(t('acceptance.workspace.batch.error'));
      } finally {
        setBatchPending(false);
      }
    };

    /**
     * File the visible selection under one project (`null` takes it out of
     * any). Rows already where they are headed count as "unchanged" in the
     * report, same as a status sweep — so moving a mixed pick states honestly
     * how many actually moved.
     */
    const sweepProject = async (projectId: string | null) => {
      const targets = acceptanceProjectTargets(items, selectedVisible, projectId);
      const attempted = selectedVisible.length;
      const successKey: BatchSuccessKey = projectId
        ? 'acceptance.workspace.batch.projectSuccess'
        : 'acceptance.workspace.batch.projectRemoveSuccess';
      // Every selected row is already in place: nothing to send, but silence
      // would read as a broken button — report the unchanged sweep instead.
      if (targets.length === 0) {
        reportBatch(0, attempted, successKey);
        return;
      }

      setBatchPending(true);
      try {
        const chunks = chunkAcceptanceBatch(targets);
        const settled = await Promise.allSettled(
          chunks.map((chunk) => verifyService.setAcceptanceProjectBatch(chunk, projectId)),
        );

        let updated = 0;
        const failedIds: string[] = [];
        settled.forEach((part, index) => {
          if (part.status === 'fulfilled') {
            updated += part.value.updated;
            failedIds.push(...part.value.failedIds);
            return;
          }
          // A chunk that never reached the server: every id in it is unchanged.
          console.error('[acceptance:batchProject]', part.reason);
          failedIds.push(...chunks[index]);
        });

        const failedSet = new Set(failedIds);
        await settleBatch(
          selectedVisible,
          targets.filter((id) => !failedSet.has(id)),
          selectedVisible.filter((id) => !targets.includes(id) || failedSet.has(id)),
        );
        reportBatch(updated, attempted, successKey);
      } catch (cause) {
        console.error('[acceptance:batchProject]', cause);
        toast.error(t('acceptance.workspace.batch.error'));
      } finally {
        setBatchPending(false);
      }
    };

    const deleteSelected = () => {
      const targets = selectedVisible;
      if (targets.length === 0) return;

      openAcceptanceDeleteConfirm({
        ids: targets,
        onDelete: async (purge) => {
          setBatchPending(true);
          try {
            // `allSettled`, never `all`: a rejected chunk must not hide the ones
            // that already deleted. Bailing out here would skip the refresh AND
            // the navigate-away, leaving the route pointed at a row a sibling
            // chunk had just removed.
            const chunks = chunkAcceptanceBatch(targets);
            const settled = await Promise.allSettled(
              chunks.map((chunk) => verifyService.deleteAcceptanceBatch(chunk, purge)),
            );

            if (settled.every((part): part is PromiseRejectedResult => part.status === 'rejected'))
              throw settled[0].reason;

            let deleted = 0;
            const failedIds: string[] = [];
            settled.forEach((part, index) => {
              if (part.status === 'fulfilled') {
                deleted += part.value.deleted;
                failedIds.push(...part.value.failedIds);
                return;
              }
              console.error('[acceptance:batchDelete]', part.reason);
              failedIds.push(...chunks[index]);
            });

            // The open acceptance just stopped existing — leave its dead route
            // rather than letting the detail pane render a 404.
            const redirect = acceptanceRedirectAfterDelete(
              acceptanceId,
              targets,
              failedIds,
              routeBase,
            );
            if (redirect) navigate(redirect, { replace: true });
            await settleBatch(targets, [], failedIds);
            reportBatch(deleted, targets.length, 'acceptance.workspace.batch.deleteSuccess');
          } finally {
            setBatchPending(false);
          }
        },
      });
    };

    // Grouping by project already names it in the header; every other mode has
    // to carry it on the row or the affiliation is simply not on screen.
    // Inside a project every row belongs to it, so naming the project again is noise.
    const showRowProject = !projectId && groupMode !== 'project';
    // "Created by me" makes every row the viewer's own, so the avatar adds nothing.
    const showRowCreator = scope !== 'created';

    const orderedIds = (showGroups ? groups.flatMap((group) => group.items) : items)
      .filter((item) => item.canManage)
      .map((item) => item.id);

    // Shift/⌘-click on a row while browsing enters selection on the spot: a
    // shift range starts from the open record, a ⌘ pick from nothing.
    const pickRow = (id: string, shift: boolean) => {
      if (!selecting) {
        setSelecting(true);
        setSelected(
          shift ? rangeAcceptanceSelection(orderedIds, acceptanceId ?? null, id, []) : [id],
        );
        setAnchorId(id);
        return;
      }
      if (shift) {
        setSelected((previous) => rangeAcceptanceSelection(orderedIds, anchorId, id, previous));
        return;
      }
      setSelected((previous) => toggleAcceptanceSelection(previous, id));
      setAnchorId(id);
    };

    const rowSelectionProps = (item: { canManage: boolean; id: string }) => ({
      selectable: selecting && item.canManage,
      selected: selecting && selectedVisible.includes(item.id),
      onToggleSelect: item.canManage ? (shift: boolean) => pickRow(item.id, shift) : undefined,
    });

    // Grouping shares the filter's popover rather than taking a fourth icon in a
    // 260px header: both answer "what does this list show me", and one of them
    // is a preference the user sets once.
    const filterItems = useAcceptanceListFilterMenu({
      facets,
      filter,
      groupMode,
      hostProjectId: projectId,
      setFacets: setStoredFacets,
      setFilter: setStoredFilter,
      setGroupMode: setStoredGroupMode,
    });

    // One overflow menu for everything the header offers. Multi-select used to
    // sit outside as its own icon; a 260px header cannot carry a fourth control
    // without crowding the search field, and "enter selection mode" is a rare
    // deliberate act, not something to keep one tap away at all times. The
    // project entries join it only when they have nowhere better to live —
    // under project grouping each group header carries its own.
    const overflowItems: DropdownItem[] = [
      {
        icon: <Icon icon={ListChecks} />,
        key: 'select',
        label: t('acceptance.workspace.batch.enter'),
        onClick: () => (selecting ? leaveSelecting() : setSelecting(true)),
      },
      ...(showGroups || !projectActionItems
        ? []
        : [{ type: 'divider' as const }, ...projectActionItems()]),
    ];

    const [panelWidth, updateSystemStatus] = useGlobalStore((s) => [
      systemStatusSelectors.verifyReportPanelWidth(s),
      s.updateSystemStatus,
    ]);

    const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
      if (!size) return;
      const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
      if (!w || isEqual(w, panelWidth)) return;
      updateSystemStatus({ verifyReportPanelWidth: w });
    };

    const body = (
      <>
        <div {...stylex.props(headerLeading ? styles.headWithBrand : styles.head)}>
          {!hosted && (
            <div {...stylex.props(headerLeading ? styles.titleRowWithBrand : styles.titleRow)}>
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={headerLeading ? 8 : 4}
                style={{ minWidth: 0 }}
              >
                {headerLeading ?? (
                  <ActionIcon
                    icon={ArrowLeft}
                    size={'small'}
                    title={t('back', { ns: 'common' })}
                    onClick={() => navigate(acceptanceHomePath())}
                  />
                )}
                <Text ellipsis strong style={{ fontSize: 15, minWidth: 0 }}>
                  {t('acceptance.workspace.title')}
                </Text>
                {!projectId && <AcceptanceScopeSwitcher />}
              </Flexbox>
              <button
                aria-label={t('workspace.collapse')}
                {...stylex.props(styles.collapseBtn)}
                title={t('workspace.collapse')}
                type={'button'}
                onClick={() => setExpand(false)}
              >
                <Icon icon={PanelLeftClose} size={16} />
              </button>
            </div>
          )}
          <div {...stylex.props(styles.searchRow)}>
            <label {...stylex.props(styles.search)}>
              <Icon className={stylex.props(styles.searchIcon).className} icon={Search} size={13} />
              <input
                {...stylex.props(styles.searchInput)}
                placeholder={t('workspace.search')}
                type={'search'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <DropdownMenu items={filterItems} placement={'bottomRight'}>
              <ActionIcon
                active={filter !== 'all' || facetsNarrowed}
                className={stylex.props(styles.filterButton).className}
                icon={ListFilter}
                size={'small'}
                title={t('acceptance.workspace.filters.title')}
              />
            </DropdownMenu>
            <DropdownMenu items={overflowItems} placement={'bottomRight'}>
              <ActionIcon
                active={selecting}
                className={stylex.props(styles.filterButton).className}
                icon={MoreHorizontal}
                size={'small'}
                title={t('acceptance.workspace.actions.more')}
              />
            </DropdownMenu>
          </div>
          {selecting && (
            <div {...stylex.props(styles.selectionRow)}>
              <Checkbox
                checked={selectAllState === 'all'}
                disabled={selectableItems.length === 0}
                indeterminate={selectAllState === 'partial'}
                onChange={() =>
                  setSelected((previous) => nextAcceptanceSelectAll(previous, selectableItems))
                }
              >
                {t('acceptance.workspace.batch.selectAll')}
              </Checkbox>
              <Flexbox flex={1} />
              <Text fontSize={12} type={'secondary'}>
                {t('acceptance.workspace.batch.selected', { count: selectedVisible.length })}
              </Text>
              <Button size={'small'} type={'text'} onClick={leaveSelecting}>
                {t('acceptance.workspace.batch.exit')}
              </Button>
            </div>
          )}
        </div>

        <Flexbox flex={1} style={{ minHeight: 0, overflowX: 'hidden', overflowY: 'auto' }}>
          {error ? (
            // A failed fetch must read as an error with a retry — never as an
            // empty "no acceptances" page.
            <Center className={stylex.props(styles.emptyState).className} gap={12}>
              <Empty
                description={t('workspace.loadError')}
                icon={TriangleAlert}
                title={t('workspace.loadErrorTitle')}
              />
              <button
                {...stylex.props(styles.retryBtn)}
                type={'button'}
                onClick={() => void mutate()}
              >
                {t('workspace.retry')}
              </button>
            </Center>
          ) : isLoading ? (
            <SkeletonList rows={6} style={{ paddingBlock: 6, paddingInline: 8 }} />
          ) : items.length === 0 ? (
            emptyVariant === 'filtered' ? (
              // A zero-result FILTER must read as "no match for this query",
              // never as the first-run empty state.
              <div {...stylex.props(styles.searchEmpty)}>
                <span {...stylex.props(styles.searchEmptyMsg)}>
                  {trimmedQuery
                    ? t('acceptance.workspace.filters.noSearchResults', { query: trimmedQuery })
                    : facetsNarrowed
                      ? t('acceptance.workspace.filters.empty.filtered')
                      : filter === 'all'
                        ? null
                        : t(EMPTY_FILTER_KEYS[filter])}
                </span>
                <button
                  {...stylex.props(styles.retryBtn)}
                  type={'button'}
                  onClick={() => {
                    setQuery('');
                    setStoredFilter('all');
                    setStoredFacets(resetAcceptanceListFacets(facets, projectId));
                  }}
                >
                  {t('acceptance.workspace.filters.showAll')}
                </button>
              </div>
            ) : (
              <Center className={stylex.props(styles.emptyState).className}>
                {/* The dashed circle is the acceptance "awaiting" glyph
                      (AcceptanceStatusPill) — the domain's own mark, not the
                      generic inbox. */}
                <Empty
                  description={t('acceptance.workspace.listEmpty')}
                  icon={CircleDashed}
                  title={t('acceptance.workspace.listEmptyTitle')}
                />
              </Center>
            )
          ) : (
            <div {...sx([styles.list], undefined, selecting ? { userSelect: 'none' } : undefined)}>
              {showGroups ? (
                <Accordion
                  gap={4}
                  indicatorPlacement="inline"
                  styles={{ trigger: { paddingBlock: 4, paddingInline: 8 } }}
                  value={expandedAcceptanceGroupKeys(groups, collapsedGroups)}
                  items={groups.map((group) => ({
                    key: group.key,
                    action:
                      groupMode === 'project' && projectActionItems ? (
                        <DropdownMenu
                          items={projectActionItems(group.projectName ? group.key : undefined)}
                          placement={'bottomRight'}
                        >
                          <ActionIcon
                            icon={MoreHorizontal}
                            size={'small'}
                            title={t('acceptance.workspace.groups.actions')}
                          />
                        </DropdownMenu>
                      ) : undefined,
                    title: (
                      <span {...stylex.props(styles.groupTitle)}>
                        {/* The folder reads as "project"; a status or age
                              bucket is not a folder and must not wear one. */}
                        {groupMode === 'project' && <Icon icon={FolderClosed} size={14} />}
                        <span>
                          {group.name ??
                            t(group.labelKey as 'acceptance.workspace.groups.ungrouped')}
                        </span>
                      </span>
                    ),
                    children: (
                      <div {...stylex.props(styles.groupList)}>
                        {group.items.map((item) => (
                          <AcceptanceRow
                            active={item.id === acceptanceId}
                            item={item}
                            key={item.id}
                            showCreator={showRowCreator}
                            showProject={showRowProject}
                            onChanged={mutate}
                            {...rowSelectionProps(item)}
                          />
                        ))}
                      </div>
                    ),
                  }))}
                  onValueChange={(keys) =>
                    setCollapsedGroups((previous) =>
                      nextCollapsedGroupKeys(previous, groups, keys.map(String)),
                    )
                  }
                />
              ) : (
                items.map((item) => (
                  <AcceptanceRow
                    active={item.id === acceptanceId}
                    item={item}
                    key={item.id}
                    showCreator={showRowCreator}
                    showProject={showRowProject}
                    onChanged={mutate}
                    {...rowSelectionProps(item)}
                  />
                ))
              )}
              {!searching && (
                <>
                  <div ref={setSentinel} style={{ height: 1 }} />
                  {isLoadingMore && (
                    <SkeletonList rows={2} style={{ paddingBlock: 4, paddingInline: 0 }} />
                  )}
                </>
              )}
            </div>
          )}
        </Flexbox>
        {selecting && (
          <AcceptanceBatchBar
            acceptCount={acceptanceBatchTargets(items, selectedVisible, 'accept').length}
            canRemoveProject={acceptanceProjectTargets(items, selectedVisible, null).length > 0}
            closeCount={acceptanceBatchTargets(items, selectedVisible, 'close').length}
            pending={batchPending || selectedVisible.length === 0}
            onAccept={() => void sweepStatus('accept', 'accepted')}
            onClose={() => void sweepStatus('close', 'closed')}
            onDelete={deleteSelected}
            onMoveToProject={(projectId) => void sweepProject(projectId)}
          />
        )}
      </>
    );

    if (hosted)
      return (
        <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
          {body}
        </Flexbox>
      );

    return (
      <DraggablePanel
        className={stylex.props(styles.panel).className}
        defaultSize={{ width: panelWidth }}
        expand={expand}
        maxWidth={PANEL_MAX}
        minWidth={PANEL_MIN}
        mode={isNarrow ? 'float' : 'fixed'}
        placement={'left'}
        size={{ height: '100%', width: panelWidth }}
        onExpandChange={setExpand}
        onSizeChange={handleSizeChange}
      >
        <DraggablePanelContainer style={{ flex: 'none', height: '100%', minWidth: PANEL_MIN }}>
          {body}
        </DraggablePanelContainer>
      </DraggablePanel>
    );
  },
);

AcceptanceListPanel.displayName = 'AcceptanceListPanel';

export default AcceptanceListPanel;

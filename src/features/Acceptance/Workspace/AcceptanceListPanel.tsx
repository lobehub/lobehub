'use client';

import {
  Accordion,
  AccordionItem,
  Center,
  DraggablePanel,
  DraggablePanelContainer,
  type DraggablePanelProps,
  Empty,
  Flexbox,
  Icon,
} from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import {
  ActionIcon,
  Button,
  Checkbox,
  confirmModal,
  DropdownMenu,
  Text,
  toast,
} from '@lobehub/ui/base-ui';
import { useDebounce } from 'ahooks';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  ArrowLeft,
  Check,
  FolderClosed,
  Group,
  ListChecks,
  ListFilter,
  PanelLeftClose,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import type { AcceptanceStatusOverride } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useAcceptanceList, useAcceptanceListInfinite } from '../hooks';
import { acceptanceHomePath } from '../Viewer/routes';
import type { AcceptanceStatusAction } from '../Viewer/statusActions';
import AcceptanceBatchBar from './AcceptanceBatchBar';
import {
  type AcceptanceListFilter,
  DEFAULT_ACCEPTANCE_LIST_FILTER,
  normalizeAcceptanceListFilter,
} from './acceptanceListFilter';
import AcceptanceRow from './AcceptanceRow';
import {
  acceptanceBatchTargets,
  acceptanceSelectAllState,
  chunkAcceptanceBatch,
  nextAcceptanceSelectAll,
  toggleAcceptanceSelection,
  visibleAcceptanceSelection,
} from './batchSelection';
import {
  type AcceptanceGroupMode,
  DEFAULT_ACCEPTANCE_GROUP_MODE,
  expandedAcceptanceGroupKeys,
  groupAcceptanceList,
  nextCollapsedGroupKeys,
  normalizeAcceptanceGroupMode,
  shouldRenderAcceptanceGroups,
} from './groupAcceptanceList';
import type { ReportPanelExpand } from './useReportPanelExpand';

const PANEL_MIN = 260;
const PANEL_MAX = 420;
const ACCEPTANCE_LIST_FILTER_STORAGE_KEY = 'lobehub-acceptance-list-filter';
const ACCEPTANCE_GROUP_MODE_STORAGE_KEY = 'lobehub-acceptance-group-mode';
/** Pull the next page before the sentinel is actually on screen. */
const LOAD_MORE_ROOT_MARGIN = '240px';
type BatchSuccessKey =
  'acceptance.workspace.batch.deleteSuccess' | 'acceptance.workspace.batch.statusSuccess';
const EMPTY_FILTER_KEYS = {
  active: 'acceptance.workspace.filters.empty.active',
  completed: 'acceptance.workspace.filters.empty.completed',
} as const satisfies Record<Exclude<AcceptanceListFilter, 'all'>, string>;

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  head: css`
    flex: none;
    padding-block: 14px 6px;
    padding-inline: 12px;
  `,
  headWithBrand: css`
    flex: none;
    padding-block: 0 6px;
    padding-inline: 12px;
  `,
  titleRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-inline: 4px;
  `,
  titleRowWithBrand: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    min-height: 48px;
    padding-inline: 4px;
  `,
  collapseBtn: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 26px;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  search: css`
    display: flex;
    gap: 7px;
    align-items: center;

    height: 32px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    svg {
      flex: none;
      color: ${cssVar.colorTextQuaternary};
    }

    input {
      width: 100%;
      min-width: 0;
      border: none;

      font-size: 13px;
      color: ${cssVar.colorText};

      background: none;
      outline: none;

      &::placeholder {
        color: ${cssVar.colorTextQuaternary};
      }
    }
  `,
  searchRow: css`
    display: flex;
    gap: 4px;
    align-items: center;

    margin-block: 8px 4px;
    margin-inline: 4px;

    > label {
      flex: 1;
      min-width: 0;
    }
  `,
  filterButton: css`
    flex: none;
  `,
  selectionRow: css`
    display: flex;
    gap: 6px;
    align-items: center;

    margin-block: 2px 4px;
    margin-inline: 4px;

    font-size: 12px;
  `,
  searchEmpty: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;

    padding-block: 24px;
    padding-inline: 12px;
  `,
  searchEmptyMsg: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
    word-break: break-word;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    padding-block: 6px 16px;
    padding-inline: 8px;
  `,
  groupList: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  groupTitle: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;

    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  emptyState: css`
    height: 100%;
    min-height: 240px;
    padding-block: 24px;
    padding-inline: 16px;
  `,
  retryBtn: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorTextTertiary};
      color: ${cssVar.colorText};
    }
  `,
}));

interface AcceptanceListPanelProps extends ReportPanelExpand {
  headerLeading?: ReactNode;
  /**
   * Renders the per-project action menu. Injected by the main app rather than
   * imported here: the actions open the create-project modal and navigate to
   * `/project/:id`, neither of which exists in the standalone workbench app —
   * and a direct import would drag the project store into its bundle.
   */
  renderProjectActions?: (projectId?: string) => ReactNode;
}

/**
 * Master list of the caller's acceptance aggregates — the acceptance twin of
 * the verify workspace's ReportListPanel, sharing its visual language and the
 * same persisted panel-width preference so the two surfaces read as one family.
 */
const AcceptanceListPanel = memo<AcceptanceListPanelProps>(
  ({ expand, headerLeading, isNarrow, renderProjectActions, setExpand }) => {
    const { t } = useTranslation('verify');
    const navigate = useNavigate();
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
    const filter = normalizeAcceptanceListFilter(storedFilter);
    const groupMode = normalizeAcceptanceGroupMode(storedGroupMode);
    const debouncedQuery = useDebounce(query.trim(), { wait: 300 });
    const trimmedQuery = query.trim();
    const searching = Boolean(debouncedQuery);

    // Two feeds, one at a time. Browsing scrolls a keyset-paged feed; searching
    // hands off to the flat read, which resolves every subject title across the
    // WHOLE owned set — a paged search would only ever match what had scrolled
    // in, and would report an exhausted list while the match sat on page four.
    const search = useAcceptanceList(searching, { filter, q: debouncedQuery || undefined });
    const {
      hasMore,
      isLoadingInitial,
      isLoadingMore,
      items: pagedItems,
      loadMore,
      ...pagedRest
    } = useAcceptanceListInfinite(searching ? null : filter);

    const items = searching ? (search.data ?? []) : pagedItems;
    const error = searching ? search.error : pagedRest.error;
    const isLoading = searching ? search.isLoading : isLoadingInitial;
    const mutate = searching ? search.mutate : pagedRest.mutate;

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
    const [batchPending, setBatchPending] = useState(false);
    const selectedVisible = visibleAcceptanceSelection(selected, items);
    const selectAllState = acceptanceSelectAllState(items.length, selectedVisible.length);

    const leaveSelecting = () => {
      setSelecting(false);
      setSelected([]);
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
      await Promise.all(changedIds.map((id) => globalMutate(verifyKeys.acceptanceBundle(id))));

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

    const deleteSelected = () => {
      const targets = selectedVisible;
      if (targets.length === 0) return;

      confirmModal({
        cancelText: t('actions.cancel'),
        content: t('acceptance.workspace.batch.deleteConfirmDescription', {
          count: targets.length,
        }),
        okButtonProps: { danger: true },
        okText: t('actions.delete'),
        title: t('acceptance.workspace.batch.deleteConfirmTitle', { count: targets.length }),
        onOk: async () => {
          setBatchPending(true);
          try {
            // `allSettled`, never `all`: a rejected chunk must not hide the ones
            // that already deleted. Bailing out here would skip the refresh AND
            // the navigate-away, leaving the route pointed at a row a sibling
            // chunk had just removed.
            const chunks = chunkAcceptanceBatch(targets);
            const settled = await Promise.allSettled(
              chunks.map((chunk) => verifyService.deleteAcceptanceBatch(chunk)),
            );

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
            if (acceptanceId && targets.includes(acceptanceId) && !failedIds.includes(acceptanceId))
              navigate(acceptanceHomePath(), { replace: true });
            await settleBatch(targets, [], failedIds);
            reportBatch(deleted, targets.length, 'acceptance.workspace.batch.deleteSuccess');
          } catch (cause) {
            console.error('[acceptance:batchDelete]', cause);
            toast.error(t('acceptance.workspace.batch.error'));
          } finally {
            setBatchPending(false);
          }
        },
      });
    };

    // Grouping by project already names it in the header; every other mode has
    // to carry it on the row or the affiliation is simply not on screen.
    const showRowProject = groupMode !== 'project';

    const rowSelectionProps = (id: string) =>
      selecting
        ? {
            selectable: true,
            selected: selectedVisible.includes(id),
            onToggleSelect: () =>
              setSelected((previous) => toggleAcceptanceSelection(previous, id)),
          }
        : undefined;

    // Grouping shares the filter's popover rather than taking a fourth icon in a
    // 260px header: both answer "what does this list show me", and one of them
    // is a preference the user sets once.
    const filterItems: DropdownItem[] = [
      ...(
        [
          ['active', t('acceptance.workspace.filters.active')],
          ['all', t('acceptance.workspace.filters.all')],
          ['completed', t('acceptance.workspace.filters.completed')],
        ] as const
      ).map(([key, label]) => ({
        icon: <Icon icon={Check} style={{ opacity: filter === key ? 1 : 0 }} />,
        key,
        label,
        onClick: () => setStoredFilter(key),
      })),
      { type: 'divider' as const },
      {
        children: (
          [
            ['project', t('acceptance.workspace.groups.byProject')],
            ['status', t('acceptance.workspace.groups.byStatus')],
            ['time', t('acceptance.workspace.groups.byTime')],
            ['none', t('acceptance.workspace.groups.byNone')],
          ] as const
        ).map(([key, label]) => ({
          icon: <Icon icon={Check} style={{ opacity: groupMode === key ? 1 : 0 }} />,
          key,
          label,
          onClick: () => setStoredGroupMode(key),
        })),
        icon: <Icon icon={Group} />,
        key: 'group-mode',
        label: t('acceptance.workspace.groups.mode'),
      },
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

    return (
      <DraggablePanel
        className={styles.panel}
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
          <div className={headerLeading ? styles.headWithBrand : styles.head}>
            <div className={headerLeading ? styles.titleRowWithBrand : styles.titleRow}>
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
              </Flexbox>
              <button
                aria-label={t('workspace.collapse')}
                className={styles.collapseBtn}
                title={t('workspace.collapse')}
                type={'button'}
                onClick={() => setExpand(false)}
              >
                <Icon icon={PanelLeftClose} size={16} />
              </button>
            </div>
            <div className={styles.searchRow}>
              <label className={styles.search}>
                <Icon icon={Search} size={13} />
                <input
                  placeholder={t('workspace.search')}
                  type={'search'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <DropdownMenu items={filterItems} placement={'bottomRight'}>
                <ActionIcon
                  active={filter !== 'all'}
                  className={styles.filterButton}
                  icon={ListFilter}
                  size={'small'}
                  title={t('acceptance.workspace.filters.title')}
                />
              </DropdownMenu>
              <ActionIcon
                active={selecting}
                className={styles.filterButton}
                icon={ListChecks}
                size={'small'}
                title={t('acceptance.workspace.batch.enter')}
                onClick={() => (selecting ? leaveSelecting() : setSelecting(true))}
              />
              {!showGroups && renderProjectActions?.()}
            </div>
            {selecting && (
              <div className={styles.selectionRow}>
                <Checkbox
                  checked={selectAllState === 'all'}
                  disabled={items.length === 0}
                  indeterminate={selectAllState === 'partial'}
                  onChange={() =>
                    setSelected((previous) => nextAcceptanceSelectAll(previous, items))
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
              <Center className={styles.emptyState} gap={12}>
                <Empty
                  description={t('workspace.loadError')}
                  icon={TriangleAlert}
                  title={t('workspace.loadErrorTitle')}
                />
                <button className={styles.retryBtn} type={'button'} onClick={() => void mutate()}>
                  {t('workspace.retry')}
                </button>
              </Center>
            ) : isLoading ? (
              <SkeletonList rows={6} style={{ paddingBlock: 6, paddingInline: 8 }} />
            ) : items.length === 0 ? (
              trimmedQuery || filter !== 'all' ? (
                // A zero-result FILTER must read as "no match for this query",
                // never as the first-run empty state.
                <div className={styles.searchEmpty}>
                  <span className={styles.searchEmptyMsg}>
                    {trimmedQuery
                      ? t('acceptance.workspace.filters.noSearchResults', { query: trimmedQuery })
                      : filter === 'all'
                        ? null
                        : t(EMPTY_FILTER_KEYS[filter])}
                  </span>
                  <button
                    className={styles.retryBtn}
                    type={'button'}
                    onClick={() => {
                      setQuery('');
                      setStoredFilter('all');
                    }}
                  >
                    {t('acceptance.workspace.filters.showAll')}
                  </button>
                </div>
              ) : (
                <Center className={styles.emptyState}>
                  <Empty
                    description={t('acceptance.workspace.listEmpty')}
                    title={t('acceptance.workspace.listEmptyTitle')}
                  />
                </Center>
              )
            ) : (
              <div className={styles.list}>
                {showGroups ? (
                  <Accordion
                    expandedKeys={expandedAcceptanceGroupKeys(groups, collapsedGroups)}
                    gap={4}
                    onExpandedChange={(keys) =>
                      setCollapsedGroups((previous) =>
                        nextCollapsedGroupKeys(previous, groups, keys.map(String)),
                      )
                    }
                  >
                    {groups.map((group) => (
                      <AccordionItem
                        itemKey={group.key}
                        key={group.key}
                        paddingBlock={4}
                        paddingInline={8}
                        action={
                          groupMode === 'project'
                            ? renderProjectActions?.(group.projectName ? group.key : undefined)
                            : undefined
                        }
                        title={
                          <span className={styles.groupTitle}>
                            {/* The folder reads as "project"; a status or age
                                bucket is not a folder and must not wear one. */}
                            {groupMode === 'project' && <Icon icon={FolderClosed} size={14} />}
                            <span>
                              {group.name ??
                                t(group.labelKey as 'acceptance.workspace.groups.ungrouped')}
                            </span>
                          </span>
                        }
                      >
                        <div className={styles.groupList}>
                          {group.items.map((item) => (
                            <AcceptanceRow
                              active={item.id === acceptanceId}
                              item={item}
                              key={item.id}
                              showProject={showRowProject}
                              onChanged={mutate}
                              {...rowSelectionProps(item.id)}
                            />
                          ))}
                        </div>
                      </AccordionItem>
                    ))}
                  </Accordion>
                ) : (
                  items.map((item) => (
                    <AcceptanceRow
                      active={item.id === acceptanceId}
                      item={item}
                      key={item.id}
                      showProject={showRowProject}
                      onChanged={mutate}
                      {...rowSelectionProps(item.id)}
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
              closeCount={acceptanceBatchTargets(items, selectedVisible, 'close').length}
              pending={batchPending || selectedVisible.length === 0}
              onAccept={() => void sweepStatus('accept', 'accepted')}
              onClose={() => void sweepStatus('close', 'closed')}
              onDelete={deleteSelected}
            />
          )}
        </DraggablePanelContainer>
      </DraggablePanel>
    );
  },
);

AcceptanceListPanel.displayName = 'AcceptanceListPanel';

export default AcceptanceListPanel;

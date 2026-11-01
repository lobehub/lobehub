'use client';

import { TRASH_RETENTION_DAYS } from '@lobechat/const';
import type {
  TrashCountByType,
  TrashItem,
  TrashProjectFilter,
  TrashResourceType,
  TrashVisibility,
} from '@lobechat/types';
import {
  Avatar,
  Button,
  Center,
  confirmModal,
  controlHeight,
  createStaticStyles,
  Empty,
  Flexbox,
  Icon,
  Segmented,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { useSize } from 'ahooks';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Trash2Icon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import type { TrashViewFilter } from '@/services/trash';
import { useLoadedProjectList, useProjectStore } from '@/store/project';
import { trashSelectors, useTrashStore } from '@/store/trash';
import { TrashEmptyScopeChangedError } from '@/store/trash/action';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, userProfileSelectors } from '@/store/user/selectors';

import DeletedByCell, { DELETED_BY_TEXT_INSET } from './DeletedByCell';
import { ProjectFilter } from './ProjectFilter';
import {
  canEmptyTrashView,
  isProjectRefusedError,
  isScopeChangedError,
  resolveProjectAvailability,
} from './projectFilterState';
import { TRASH_TYPE_ICON, TRASH_TYPE_ORDER } from './typeMeta';

dayjs.extend(relativeTime);

/** Stable empties so the replicated views never trip the store's shallow equality. */
const TRASH_LIST_BREAKPOINT = 800;
const EMPTY_ITEMS: TrashItem[] = [];
const EMPTY_COUNTS: TrashCountByType = {};
const NAME_ICON_SIZE = 28;
const NAME_ICON_GAP = 10;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding-block: 16px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
  /**
   * Type chips on the small control height: with the track's 3px padding and
   * 1px border the whole Segmented is `controlHeight.middle` tall, level with
   * the side switch, the project picker and the empty button beside it.
   */
  filterItem: css`
    height: ${controlHeight.small}px;
  `,
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block-end: 16px;
    padding-inline: 24px;
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
  name: css`
    width: 100%;
    min-width: 0;
  `,
  table: css`
    @container (max-width: ${TRASH_LIST_BREAKPOINT}px) {
      tbody tr {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      td[data-list-slot='title'] {
        min-width: 0;
      }
    }
  `,
  title: css`
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;

    @container (max-width: ${TRASH_LIST_BREAKPOINT}px) {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;

      overflow-wrap: anywhere;
      white-space: normal;
    }
  `,
}));

interface TrashListProps {
  /** A workspace bin: split into its public and private sides. */
  isWorkspace?: boolean;
}

/** A column header that starts where its cells' text does, past a leading icon or avatar. */
const InsetTitle = ({ children, inset }: { children: string; inset: number }) => (
  <span style={{ paddingInlineStart: inset }}>{children}</span>
);

const TrashList = ({ isWorkspace = false }: TrashListProps) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const mobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useSize(containerRef);
  const cardLayout = !!containerSize && containerSize.width <= TRASH_LIST_BREAKPOINT;

  const [
    activeType,
    loadingIds,
    setFilter,
    restore,
    purge,
    emptyTrash,
    loadMore,
    useFetchTrash,
    useFetchTrashCount,
  ] = useTrashStore((s) => [
    s.activeType,
    s.loadingIds,
    s.setFilter,
    s.restore,
    s.purge,
    s.emptyTrash,
    s.loadMore,
    s.useFetchTrash,
    s.useFetchTrashCount,
  ]);

  // Projects are a Labs feature: without it the bin is not filtered by project.
  const scope = useCacheScope();
  const projectsEnabled = useUserStore(labPreferSelectors.enableProjects);
  const selectedProjectId = useTrashStore(trashSelectors.activeProjectId(scope));
  const projectId: TrashProjectFilter = projectsEnabled ? selectedProjectId : undefined;
  const visibility = useTrashStore(trashSelectors.activeVisibility(isWorkspace));
  const filter: TrashViewFilter = { projectId, resourceType: activeType, visibility };
  const countFilter = { projectId, visibility };

  // The public side lists every member's deletions: each row is managed by
  // whoever deleted it, and by owners and admins, who alone may empty it.
  const userId = useUserStore(userProfileSelectors.userId);
  const { allowed: isManager } = usePermission('manage_settings');
  const isPublicSide = visibility === 'public';
  const canManageItem = (item: TrashItem) =>
    !isPublicSide || isManager || (item.deletedByUserId ?? item.userId) === userId;

  // The live project list of this scope is the only source of project options.
  const projectSync = useProjectStore((s) => s.useFetchProjectList)(projectsEnabled);
  const refreshProjectList = useProjectStore((s) => s.refreshProjectList);
  const projects = useLoadedProjectList();
  const listedAvailability = resolveProjectAvailability({ projectId, projects });
  // A project the live list no longer holds is not asked for at all.
  const canFetch = listedAvailability !== 'unavailable';

  // The active view's local-first page: first frame paints from storage.
  const list = useTrashStore(trashSelectors.currentList(filter));
  const isEmpty = useTrashStore(trashSelectors.isEmpty(filter));
  const counts = useTrashStore(trashSelectors.countByType(countFilter));
  const storedFilterCount = useTrashStore(trashSelectors.filterCount(filter));
  const storedTotal = useTrashStore(trashSelectors.totalCount(countFilter));

  const { error, isValidating, revalidate } = useFetchTrash(canFetch, filter);
  const countSync = useFetchTrashCount(canFetch, countFilter);

  // The server refuses a project that was deleted or whose access was revoked;
  // re-read the project list so the picker drops it as well.
  const refused = isProjectRefusedError(error) || isProjectRefusedError(countSync.error);
  useEffect(() => {
    if (refused) void refreshProjectList();
  }, [refused, refreshProjectList]);

  const availability = resolveProjectAvailability({ projectId, projects, refused });
  const projectUnavailable = availability === 'unavailable';
  const listError = refused ? undefined : error;

  // Counts cached for a project that is gone describe nothing the user can act on.
  const countByType = (!projectUnavailable && counts) || EMPTY_COUNTS;
  const filterCount = projectUnavailable ? undefined : storedFilterCount;
  const total = projectUnavailable ? 0 : storedTotal;

  // An unavailable project keeps the view restricted to it, showing nothing.
  const items = (!projectUnavailable && list?.items) || EMPTY_ITEMS;
  const nextCursor = projectUnavailable ? null : (list?.nextCursor ?? null);
  const isLoadingMore = !!list?.isLoadingMore;
  const isLoading = !isEmpty && items.length === 0 && isValidating && !projectUnavailable;

  const canEmpty = canEmptyTrashView({
    availability,
    countsSettled: !countSync.isValidating,
    filterCount,
    hasError: !!error || !!countSync.error,
    itemCount: items.length,
  });

  const typeLabel = (type: TrashResourceType) => t(`trash.type.${type}` as const);
  const projectLabel = (id: TrashProjectFilter) => {
    if (id === undefined) return t('trash.filter.project.all');
    if (id === null) return t('trash.filter.project.none');
    const project = projects?.find((item) => item.id === id);
    return project
      ? `${project.name} (${project.identifier})`
      : t('trash.filter.project.unavailable');
  };
  const emptyLabel = (view: TrashViewFilter, count?: number) => {
    if (view.projectId !== undefined)
      // Never a confident zero while the counts are still unknown.
      return count === undefined
        ? t('trash.actions.emptyFilteredPending')
        : t('trash.actions.emptyFiltered', { count });
    if (view.resourceType)
      return t('trash.actions.emptyType', { type: typeLabel(view.resourceType) });
    return t('trash.actions.empty');
  };

  const changeFilter = (next: TrashViewFilter) => setFilter(next, scope);

  // A rejected call (network / server) must not end in a silent spinner stop:
  // the user has to know whether the row was restored or deleted.
  const reportFailure = () => toast.error(tc('operationFailed'));

  const handleRestore = async (item: TrashItem) => {
    let outcome: Awaited<ReturnType<typeof restore>>;
    try {
      outcome = await restore([item.id]);
    } catch {
      reportFailure();
      return;
    }
    const failure = outcome.failed[0];
    if (failure) {
      toast.error(t(`trash.restore.failed.${failure.code}`));
      return;
    }
    toast.success(t('trash.restore.success'));
  };

  const handlePurge = (item: TrashItem) => {
    confirmModal({
      cancelText: tc('cancel'),
      content: t('trash.purgeConfirm.content', { title: item.title || t('trash.untitled') }),
      okButtonProps: { danger: true },
      okText: t('trash.actions.purge'),
      onOk: async () => {
        let outcome: Awaited<ReturnType<typeof purge>>;
        try {
          outcome = await purge([item.id]);
        } catch {
          reportFailure();
          return;
        }
        if (outcome.blocked.length > 0) {
          toast.warning(t('trash.purge.blocked', { count: outcome.blocked.length }));
          return;
        }
        toast.success(t('trash.purge.success'));
      },
      title: t('trash.purgeConfirm.title'),
    });
  };

  const handleEmpty = () => {
    // Fixed for the whole sweep: switching the view while it runs never widens it.
    const view: TrashViewFilter = { ...filter };
    const count = filterCount ?? 0;
    const filtered = view.projectId !== undefined || !!view.resourceType;
    confirmModal({
      cancelText: tc('cancel'),
      content: (
        <Flexbox gap={8}>
          <span>{t('trash.emptyConfirm.content', { count })}</span>
          {filtered && (
            <Text type={'secondary'}>
              {t('trash.emptyConfirm.scope', {
                project: projectLabel(view.projectId),
                type: view.resourceType ? typeLabel(view.resourceType) : t('trash.filter.type.all'),
              })}
            </Text>
          )}
        </Flexbox>
      ),
      okButtonProps: { danger: true },
      okText: emptyLabel(view, count),
      onOk: async () => {
        let blocked: number;
        try {
          ({ blocked } = await emptyTrash(view));
        } catch (error) {
          if (error instanceof TrashEmptyScopeChangedError || isScopeChangedError(error)) {
            toast.error(t('trash.emptyStopped.scopeChanged'));
          } else if (isProjectRefusedError(error)) {
            toast.error(t('trash.projectUnavailable.title'));
            void refreshProjectList();
          } else {
            reportFailure();
          }
          return;
        }
        if (blocked > 0) {
          toast.warning(t('trash.purge.blocked', { count: blocked }));
          return;
        }
        toast.success(t('trash.purge.success'));
      },
      title: filtered ? t('trash.emptyConfirm.filteredTitle') : t('trash.emptyConfirm.title'),
    });
  };

  const expiresLabel = (expiresAt: Date) => {
    const days = dayjs(expiresAt).diff(dayjs(), 'day');
    return days < 1 ? t('trash.expiresIn.soon') : t('trash.expiresIn.days', { count: days });
  };

  const columns: LiteTableColumn<TrashItem>[] = [
    {
      key: 'name',
      listSlot: 'title',
      render: (item) => {
        const TypeIcon = TRASH_TYPE_ICON[item.resourceType];
        const avatar = item.meta?.avatar;
        const title = item.title || t('trash.untitled');
        return (
          <Flexbox horizontal align={'center'} className={styles.name} gap={NAME_ICON_GAP}>
            {avatar ? (
              <Avatar
                avatar={avatar}
                background={item.meta?.backgroundColor ?? undefined}
                size={NAME_ICON_SIZE}
                style={{ flexShrink: 0 }}
              />
            ) : (
              <Center
                height={NAME_ICON_SIZE}
                style={{ borderRadius: 6, flex: 'none', opacity: 0.7 }}
                width={NAME_ICON_SIZE}
              >
                <Icon icon={TypeIcon} size={18} />
              </Center>
            )}
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <Text
                as={'span'}
                className={styles.title}
                tabIndex={0}
                ellipsis={{
                  rows: cardLayout ? 2 : undefined,
                  tooltip: {
                    placement: 'topLeft',
                    standalone: true,
                    styles: {
                      content: { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
                      root: { maxWidth: 'min(420px, calc(100vw - 32px))' },
                    },
                    title,
                  },
                  tooltipWhenOverflow: true,
                }}
              >
                {title}
              </Text>
              {!!item.meta?.childCount && (
                <Text fontSize={12} type={'secondary'}>
                  {t('trash.meta.children', { count: item.meta.childCount })}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        );
      },
      title: (
        <InsetTitle inset={NAME_ICON_SIZE + NAME_ICON_GAP}>{t('trash.columns.name')}</InsetTitle>
      ),
      width: 'clamp(320px, 36cqw, 420px)',
    },
    {
      key: 'type',
      render: (item) => <Tag>{typeLabel(item.resourceType)}</Tag>,
      title: t('trash.columns.type'),
    },
    {
      key: 'deletedAt',
      render: (item) => (
        <span className={styles.muted} title={dayjs(item.deletedAt).format('YYYY-MM-DD HH:mm')}>
          {dayjs(item.deletedAt).fromNow()}
        </span>
      ),
      title: t('trash.columns.deletedAt'),
    },
    ...(isPublicSide
      ? [
          {
            key: 'deletedBy',
            listLabel: t('trash.columns.deletedBy'),
            render: (item: TrashItem) => <DeletedByCell userId={item.deletedByUserId} />,
            title: (
              <InsetTitle inset={DELETED_BY_TEXT_INSET}>{t('trash.columns.deletedBy')}</InsetTitle>
            ),
          },
        ]
      : []),
    {
      key: 'expiresAt',
      render: (item) => <span className={styles.muted}>{expiresLabel(item.expiresAt)}</span>,
      title: t('trash.columns.expiresIn'),
    },
    {
      key: 'actions',
      listSlot: 'actions',
      render: (item) => {
        if (!canManageItem(item)) return null;
        const busy = loadingIds.includes(item.id);
        return (
          <Flexbox horizontal gap={4} onClick={(e) => e.stopPropagation()}>
            <Button loading={busy} size={'small'} onClick={() => handleRestore(item)}>
              {t('trash.actions.restore')}
            </Button>
            <Button
              danger
              disabled={busy}
              size={'small'}
              type={'text'}
              onClick={() => handlePurge(item)}
            >
              {t('trash.actions.purge')}
            </Button>
          </Flexbox>
        );
      },
      title: '',
      width: 200,
    },
  ];

  const typeOptions = [
    { label: `${t('trash.filter.all')}${total ? ` · ${total}` : ''}`, value: 'all' },
    // The selected type stays listed at zero, so the active filter is always visible.
    ...TRASH_TYPE_ORDER.filter((type) => countByType[type] || type === activeType).map((type) => ({
      label: `${typeLabel(type)} · ${countByType[type] ?? 0}`,
      value: type,
    })),
  ];

  const emptyDescription = () => {
    if (filter.projectId !== undefined) return t('trash.emptyFilter.desc');
    if (activeType) return t('trash.emptyType.desc', { type: typeLabel(activeType) });
    return t('trash.empty.desc', { days: TRASH_RETENTION_DAYS });
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <Flexbox horizontal align={'center'} gap={8} style={{ flexWrap: 'wrap', minWidth: 0 }}>
          {visibility && (
            <Segmented
              classNames={{ item: styles.filterItem }}
              size={'small'}
              value={visibility}
              options={[
                { label: t('trash.side.public'), value: 'public' },
                { label: t('trash.side.private'), value: 'private' },
              ]}
              onChange={(value) =>
                // Each side has its own types, so the type filter starts over.
                changeFilter({ projectId, visibility: value as TrashVisibility })
              }
            />
          )}
          <Segmented
            classNames={{ item: styles.filterItem }}
            options={typeOptions}
            size={'small'}
            style={{ flexWrap: 'wrap', maxWidth: '100%' }}
            value={activeType ?? 'all'}
            onChange={(value) =>
              changeFilter({
                projectId,
                resourceType: value === 'all' ? undefined : (value as TrashResourceType),
                visibility,
              })
            }
          />
          {projectsEnabled && (
            <ProjectFilter
              error={projectSync.error}
              isValidating={projectSync.isValidating}
              projects={projects}
              unavailable={projectUnavailable}
              value={projectId}
              onOpen={() => void refreshProjectList()}
              onRetry={() => void refreshProjectList()}
              onChange={(next) =>
                changeFilter({ projectId: next, resourceType: activeType, visibility })
              }
            />
          )}
        </Flexbox>
        {(!isPublicSide || isManager) && (
          <Button
            danger
            disabled={!canEmpty}
            icon={Trash2Icon}
            size={mobile ? 'small' : undefined}
            onClick={handleEmpty}
          >
            {emptyLabel(filter, filterCount)}
          </Button>
        )}
      </div>
      <LiteTable
        className={styles.table}
        columns={columns}
        dataSource={items}
        listBreakpoint={TRASH_LIST_BREAKPOINT}
        loading={isLoading}
        rowKey={(item) => item.id}
        tableLayout={'fixed'}
        emptyText={
          <Center height={240} width={'100%'}>
            {projectUnavailable ? (
              <Empty
                description={t('trash.projectUnavailable.desc')}
                title={t('trash.projectUnavailable.title')}
              />
            ) : listError ? (
              <Empty
                description={t('trash.loadFailed.desc')}
                title={t('trash.loadFailed.title')}
                action={
                  <Button loading={isValidating} size={'small'} onClick={() => revalidate()}>
                    {tc('retry')}
                  </Button>
                }
              />
            ) : (
              <Empty
                description={emptyDescription()}
                title={
                  activeType || filter.projectId !== undefined ? undefined : t('trash.empty.title')
                }
              />
            )}
          </Center>
        }
      />
      {nextCursor && (
        <Center style={{ paddingBlockStart: 12 }}>
          <Button
            loading={isLoadingMore}
            size={'small'}
            type={'text'}
            onClick={() => loadMore(filter).catch(reportFailure)}
          >
            {t('trash.actions.loadMore')}
          </Button>
        </Center>
      )}
    </div>
  );
};

export default TrashList;

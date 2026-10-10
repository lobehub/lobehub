'use client';

import { TRASH_RETENTION_DAYS } from '@lobechat/const';
import type { TrashCountByType, TrashItem, TrashResourceType } from '@lobechat/types';
import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Button, confirmModal, Segmented, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { useSize } from 'ahooks';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Trash2Icon } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { trashSelectors, useTrashStore } from '@/store/trash';

import { TRASH_TYPE_ICON, TRASH_TYPE_ORDER } from './typeMeta';

dayjs.extend(relativeTime);

/** Stable empties so the replicated views never trip the store's shallow equality. */
const TRASH_LIST_BREAKPOINT = 800;
const EMPTY_ITEMS: TrashItem[] = [];
const EMPTY_COUNTS: TrashCountByType = {};

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding-block: 16px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
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

const TrashList = () => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const mobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useSize(containerRef);
  const cardLayout = !!containerSize && containerSize.width <= TRASH_LIST_BREAKPOINT;

  const [
    activeType,
    countByType,
    loadingIds,
    setActiveType,
    restore,
    purge,
    emptyTrash,
    loadMore,
    useFetchTrash,
    useFetchTrashCount,
  ] = useTrashStore((s) => [
    s.activeType,
    s.trashCountMap.all ?? EMPTY_COUNTS,
    s.loadingIds,
    s.setActiveType,
    s.restore,
    s.purge,
    s.emptyTrash,
    s.loadMore,
    s.useFetchTrash,
    s.useFetchTrashCount,
  ]);

  // The active filter's local-first page: first frame paints from storage.
  const list = useTrashStore(trashSelectors.currentList(activeType));
  const items = list?.items ?? EMPTY_ITEMS;
  const nextCursor = list?.nextCursor ?? null;
  const isLoadingMore = !!list?.isLoadingMore;
  const isEmpty = useTrashStore(trashSelectors.isEmpty(activeType));
  const total = useTrashStore(trashSelectors.totalCount);

  const { error, isValidating, revalidate } = useFetchTrash(true, activeType);
  useFetchTrashCount(true);

  const isLoading = !isEmpty && items.length === 0 && isValidating;

  const typeLabel = (type: TrashResourceType) => t(`trash.type.${type}` as const);

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
        try {
          await purge([item.id]);
        } catch {
          reportFailure();
          return;
        }
        toast.success(t('trash.purge.success'));
      },
      title: t('trash.purgeConfirm.title'),
    });
  };

  const handleEmpty = () => {
    const count = activeType ? (countByType[activeType] ?? items.length) : total;
    confirmModal({
      cancelText: tc('cancel'),
      content: t('trash.emptyConfirm.content', { count }),
      okButtonProps: { danger: true },
      okText: activeType
        ? t('trash.actions.emptyType', { type: typeLabel(activeType) })
        : t('trash.actions.empty'),
      onOk: async () => {
        try {
          await emptyTrash();
        } catch {
          reportFailure();
          return;
        }
        toast.success(t('trash.purge.success'));
      },
      title: t('trash.emptyConfirm.title'),
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
          <Flexbox horizontal align={'center'} className={styles.name} gap={10}>
            {avatar ? (
              <Avatar
                avatar={avatar}
                background={item.meta?.backgroundColor ?? undefined}
                size={28}
                style={{ flexShrink: 0 }}
              />
            ) : (
              <Center
                height={28}
                style={{ borderRadius: 6, flex: 'none', opacity: 0.7 }}
                width={28}
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
      title: t('trash.columns.name'),
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
    {
      key: 'expiresAt',
      render: (item) => <span className={styles.muted}>{expiresLabel(item.expiresAt)}</span>,
      title: t('trash.columns.expiresIn'),
    },
    {
      key: 'actions',
      listSlot: 'actions',
      render: (item) => {
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
    ...TRASH_TYPE_ORDER.filter((type) => countByType[type]).map((type) => ({
      label: `${typeLabel(type)} · ${countByType[type]}`,
      value: type,
    })),
  ];

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <Segmented
          options={typeOptions}
          size={'small'}
          style={{ flexWrap: 'wrap', maxWidth: '100%' }}
          value={activeType ?? 'all'}
          onChange={(value) =>
            setActiveType(value === 'all' ? undefined : (value as TrashResourceType))
          }
        />
        <Button
          danger
          disabled={items.length === 0}
          icon={Trash2Icon}
          size={mobile ? 'small' : undefined}
          onClick={handleEmpty}
        >
          {activeType
            ? t('trash.actions.emptyType', { type: typeLabel(activeType) })
            : t('trash.actions.empty')}
        </Button>
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
            {error ? (
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
                title={activeType ? undefined : t('trash.empty.title')}
                description={
                  activeType
                    ? t('trash.emptyType.desc', { type: typeLabel(activeType) })
                    : t('trash.empty.desc', { days: TRASH_RETENTION_DAYS })
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
            onClick={() => loadMore().catch(reportFailure)}
          >
            {t('trash.actions.loadMore')}
          </Button>
        </Center>
      )}
    </div>
  );
};

export default TrashList;

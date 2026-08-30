'use client';

import { TRASH_RETENTION_DAYS } from '@lobechat/const';
import type { TrashItem, TrashResourceType } from '@lobechat/types';
import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Button, confirmModal, Segmented, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { trashSelectors, useTrashStore } from '@/store/trash';

import { TRASH_TYPE_ICON, TRASH_TYPE_ORDER } from './typeMeta';

dayjs.extend(relativeTime);

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
  title: css`
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const TrashList = () => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const mobile = useIsMobile();

  const [
    items,
    nextCursor,
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
    s.items,
    s.nextCursor,
    s.activeType,
    s.countByType,
    s.loadingIds,
    s.setActiveType,
    s.restore,
    s.purge,
    s.emptyTrash,
    s.loadMore,
    s.useFetchTrash,
    s.useFetchTrashCount,
  ]);
  const isEmpty = useTrashStore(trashSelectors.isEmpty);
  const total = useTrashStore(trashSelectors.totalCount);

  const { isLoading } = useFetchTrash(true, activeType);
  useFetchTrashCount(true);

  const typeLabel = (type: TrashResourceType) => t(`trash.type.${type}` as const);

  const handleRestore = async (item: TrashItem) => {
    const outcome = await restore([item.id]);
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
        await purge([item.id]);
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
        await emptyTrash();
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
        return (
          <Flexbox horizontal align={'center'} gap={10} style={{ minWidth: 0 }}>
            {avatar ? (
              <Avatar
                avatar={avatar}
                background={item.meta?.backgroundColor ?? undefined}
                size={28}
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
            <Flexbox style={{ minWidth: 0 }}>
              <span className={styles.title}>{item.title || t('trash.untitled')}</span>
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
    },
    {
      key: 'type',
      render: (item) => <Tag>{typeLabel(item.resourceType)}</Tag>,
      title: t('trash.columns.type'),
      width: 130,
    },
    {
      key: 'deletedAt',
      render: (item) => (
        <span className={styles.muted} title={dayjs(item.deletedAt).format('YYYY-MM-DD HH:mm')}>
          {dayjs(item.deletedAt).fromNow()}
        </span>
      ),
      title: t('trash.columns.deletedAt'),
      width: 150,
    },
    {
      key: 'expiresAt',
      render: (item) => <span className={styles.muted}>{expiresLabel(item.expiresAt)}</span>,
      title: t('trash.columns.expiresIn'),
      width: 140,
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
    <div className={styles.container}>
      <div className={styles.header}>
        <Segmented
          options={typeOptions}
          size={'small'}
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
        columns={columns}
        dataSource={items}
        loading={isLoading && !isEmpty && items.length === 0}
        rowKey={(item) => item.id}
        emptyText={
          <Center height={240} width={'100%'}>
            <Empty
              title={activeType ? undefined : t('trash.empty.title')}
              description={
                activeType
                  ? t('trash.emptyType.desc', { type: typeLabel(activeType) })
                  : t('trash.empty.desc', { days: TRASH_RETENTION_DAYS })
              }
            />
          </Center>
        }
      />
      {nextCursor && (
        <Center style={{ paddingBlockStart: 12 }}>
          <Button size={'small'} type={'text'} onClick={() => loadMore()}>
            {t('trash.actions.loadMore')}
          </Button>
        </Center>
      )}
    </div>
  );
};

export default TrashList;

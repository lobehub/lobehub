'use client';

import { TRASH_RETENTION_DAYS } from '@lobechat/const';
import type { TrashItem, TrashResourceType } from '@lobechat/types';
import { Center, Empty, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import {
  Avatar,
  Button,
  Checkbox,
  confirmModal,
  Segmented,
  Tag,
  Text,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useTrashStore } from '@/store/trash';

import {
  getDeletedByLabel,
  getPurgeFeedback,
  getRestoreFeedback,
  toggleTrashSelection,
} from './trashListUtils';
import { TRASH_TYPE_ICON, TRASH_TYPE_ORDER } from './typeMeta';

dayjs.extend(relativeTime);

const NAME_HEADER_ICON_OFFSET = 28 + 10;
const NAME_HEADER_SELECTION_OFFSET = 16 + 10;

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

interface TrashListProps {
  cacheScope: string | null;
}

const TrashList = ({ cacheScope }: TrashListProps) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const mobile = useIsMobile();
  const members = useWorkspaceMembers();
  const { allowed: canRestore, reason: restorePermissionReason } =
    usePermission('edit_own_content');
  const { allowed: canPurge, reason: purgePermissionReason } = usePermission('manage_settings');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [
    storedItems,
    storedNextCursor,
    activeType,
    storedCountByType,
    itemsScopeId,
    countScopeId,
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
    s.itemsScopeId,
    s.countScopeId,
    s.loadingIds,
    s.setActiveType,
    s.restore,
    s.purge,
    s.emptyTrash,
    s.loadMore,
    s.useFetchTrash,
    s.useFetchTrashCount,
  ]);
  const scopeId = cacheScope;
  const items = itemsScopeId === scopeId ? storedItems : [];
  const nextCursor = itemsScopeId === scopeId ? storedNextCursor : null;
  const countByType = countScopeId === scopeId ? storedCountByType : {};
  const total = Object.values(countByType).reduce((sum, count) => sum + (count ?? 0), 0);

  const { error, isLoading, mutate: retry } = useFetchTrash(true, activeType, scopeId);
  useFetchTrashCount(true, scopeId);

  const visibleIdSet = new Set(items.map((item) => item.id));
  const effectiveSelectedIds = selectedIds.filter((id) => visibleIdSet.has(id));
  const selectedItems = items.filter((item) => effectiveSelectedIds.includes(item.id));
  const allSelected = items.length > 0 && effectiveSelectedIds.length === items.length;
  const selectionBusy = selectedItems.some((item) => loadingIds.includes(item.id));

  const typeLabel = (type: TrashResourceType) => t(`trash.type.${type}` as const);

  const handleRestore = async (targets: TrashItem[]) => {
    try {
      const outcome = await restore(targets.map((item) => item.id));
      setSelectedIds((current) =>
        current.filter((id) => !outcome.restored.some((item) => item.id === id)),
      );
      const feedback = getRestoreFeedback(outcome);
      toast[feedback.level](t(feedback.key, feedback.params));
    } catch (cause) {
      console.error(cause);
      toast.error(t('trash.actions.failed'));
    }
  };

  const handlePurge = (targets: TrashItem[]) => {
    confirmModal({
      cancelText: tc('cancel'),
      content:
        targets.length === 1
          ? t('trash.purgeConfirm.content', {
              title: targets[0].title || t('trash.untitled'),
            })
          : t('trash.purgeConfirm.multiContent', { count: targets.length }),
      okButtonProps: { danger: true },
      okText: t('trash.actions.purge'),
      onOk: async () => {
        try {
          const outcome = await purge(targets.map((item) => item.id));
          setSelectedIds((current) => current.filter((id) => !outcome.purgedIds.includes(id)));
          const feedback = getPurgeFeedback(outcome);
          toast[feedback.level](t(feedback.key, feedback.params));
        } catch (cause) {
          console.error(cause);
          toast.error(t('trash.actions.failed'));
        }
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
          const outcome = await emptyTrash();
          setSelectedIds([]);
          toast.success(t('trash.empty.scheduled', { count: outcome.scheduled }));
        } catch (cause) {
          console.error(cause);
          toast.error(t('trash.actions.failed'));
        }
      },
      title: t('trash.emptyConfirm.title'),
    });
  };

  const expiresLabel = (expiresAt: Date) => {
    const days = dayjs(expiresAt).diff(dayjs(), 'day');
    return days < 1 ? t('trash.expiresIn.soon') : t('trash.expiresIn.days', { count: days });
  };

  const deletedByLabel = (item: TrashItem) => {
    return getDeletedByLabel(item, members, {
      formerMember: t('trash.deletedBy.unknown'),
      you: t('trash.deletedBy.you'),
    });
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
            {canRestore && (
              <Checkbox
                checked={effectiveSelectedIds.includes(item.id)}
                onChange={(checked) =>
                  setSelectedIds((current) => toggleTrashSelection(current, item.id, checked))
                }
              />
            )}
            {avatar ? (
              <Avatar avatar={avatar} size={28} />
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
            </Flexbox>
          </Flexbox>
        );
      },
      title: (
        <span
          style={{
            display: 'block',
            paddingInlineStart:
              NAME_HEADER_ICON_OFFSET + (canRestore ? NAME_HEADER_SELECTION_OFFSET : 0),
          }}
        >
          {t('trash.columns.name')}
        </span>
      ),
    },
    {
      key: 'deletedBy',
      render: (item) => <span className={styles.muted}>{deletedByLabel(item)}</span>,
      title: t('trash.columns.deletedBy'),
      width: 140,
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
            <Tooltip title={canRestore ? undefined : restorePermissionReason}>
              <Button
                disabled={!canRestore}
                loading={busy}
                size={'small'}
                onClick={() => handleRestore([item])}
              >
                {t('trash.actions.restore')}
              </Button>
            </Tooltip>
            <Tooltip title={canPurge ? undefined : purgePermissionReason}>
              <Button
                danger
                disabled={!canPurge || busy}
                size={'small'}
                type={'text'}
                onClick={() => handlePurge([item])}
              >
                {t('trash.actions.purge')}
              </Button>
            </Tooltip>
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
        <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
          <Segmented
            options={typeOptions}
            size={'small'}
            value={activeType ?? 'all'}
            onChange={(value) => {
              setSelectedIds([]);
              setActiveType(value === 'all' ? undefined : (value as TrashResourceType));
            }}
          />
          {canRestore && items.length > 0 && (
            <Checkbox
              checked={allSelected}
              indeterminate={effectiveSelectedIds.length > 0 && !allSelected}
              onChange={(checked) => setSelectedIds(checked ? items.map((item) => item.id) : [])}
            >
              {t('trash.selection.count', { count: effectiveSelectedIds.length })}
            </Checkbox>
          )}
        </Flexbox>
        <Flexbox horizontal gap={8}>
          {effectiveSelectedIds.length > 0 && (
            <>
              <Button
                disabled={selectionBusy}
                loading={selectionBusy}
                onClick={() => handleRestore(selectedItems)}
              >
                {t('trash.actions.restoreSelected', { count: effectiveSelectedIds.length })}
              </Button>
              <Tooltip title={canPurge ? undefined : purgePermissionReason}>
                <Button
                  danger
                  disabled={!canPurge || selectionBusy}
                  onClick={() => handlePurge(selectedItems)}
                >
                  {t('trash.actions.purgeSelected', { count: effectiveSelectedIds.length })}
                </Button>
              </Tooltip>
            </>
          )}
          <Tooltip title={canPurge ? undefined : purgePermissionReason}>
            <Button
              danger
              disabled={!canPurge || items.length === 0}
              icon={Trash2Icon}
              size={mobile ? 'small' : undefined}
              onClick={handleEmpty}
            >
              {activeType
                ? t('trash.actions.emptyType', { type: typeLabel(activeType) })
                : t('trash.actions.empty')}
            </Button>
          </Tooltip>
        </Flexbox>
      </div>
      <LiteTable
        columns={columns}
        dataSource={items}
        loading={isLoading && items.length === 0}
        rowKey={(item) => item.id}
        emptyText={
          <Center height={240} width={'100%'}>
            {error ? (
              <Empty
                title={t('trash.error.title')}
                description={
                  <Flexbox align={'center'} gap={12}>
                    <Text type={'secondary'}>{t('trash.error.desc')}</Text>
                    <Button size={'small'} onClick={() => retry()}>
                      {tc('retry')}
                    </Button>
                  </Flexbox>
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
            onClick={async () => {
              setIsLoadingMore(true);
              try {
                await loadMore();
              } catch (cause) {
                console.error(cause);
                toast.error(t('trash.loadMore.failed'));
              } finally {
                setIsLoadingMore(false);
              }
            }}
          >
            {t('trash.actions.loadMore')}
          </Button>
        </Center>
      )}
    </div>
  );
};

export default TrashList;

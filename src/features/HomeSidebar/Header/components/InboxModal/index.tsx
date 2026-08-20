'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import {
  Button,
  createModal,
  DropdownMenu,
  ModalClose,
  ModalHeader,
  ModalTitle,
  Tabs,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  ArchiveIcon,
  AtSignIcon,
  BellIcon,
  BellRingIcon,
  BotIcon,
  Building2Icon,
  CalendarClockIcon,
  CheckCheckIcon,
  CreditCardIcon,
  ListTodoIcon,
  MoreHorizontalIcon,
  SparklesIcon,
  TagIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { PENDING_TRANSFERS_SWR_KEY } from '@/features/ResourceTransferRequest';
import dynamic from '@/libs/next/dynamic';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { inboxKeys } from '@/libs/swr/keys';
import { notificationService } from '@/services/notification';
import type { PendingTransferRequest } from '@/services/resourceTransferRequest';
import { resourceTransferRequestService } from '@/services/resourceTransferRequest';

import type { NotificationListHandle } from './useNotificationList';

const Content = dynamic(() => import('./Content'), {
  loading: () => (
    <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
      <SkeletonList rows={5} />
    </Flexbox>
  ),
  ssr: false,
});

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    min-height: 0;
  `,
  categoryList: css`
    overflow-y: auto;
    overscroll-behavior: contain;
    flex: 1;
  `,
  header: css`
    flex: none;
    gap: 0;
    padding: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerMain: css`
    min-width: 0;
    padding-block: 12px;
    padding-inline: 16px;
  `,
  headerTitle: css`
    flex: none;

    box-sizing: border-box;
    width: clamp(160px, 22vw, 220px);
    padding-inline: 16px;

    white-space: nowrap;
  `,
  main: css`
    overflow: hidden;
    min-width: 0;
  `,
  root: css`
    overflow: hidden;
  `,
  sidebar: css`
    overflow: hidden;
    flex: none;

    box-sizing: border-box;
    width: clamp(160px, 22vw, 220px);
    padding: 8px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface CategoryCount {
  category: string;
  readCount: number;
  totalCount: number;
  unreadCount: number;
}

type ReadStatus = 'all' | 'read' | 'unread';

const ALL_FILTER = '__all__';
const PERSONAL_INBOX_CATEGORIES: readonly string[] = [
  'pending',
  'agent',
  'billing',
  'generation',
  'schedule',
  'system',
];
const WORKSPACE_INBOX_CATEGORIES: readonly string[] = [
  'pending',
  'mention',
  'agent',
  'generation',
  'schedule',
  'system',
  'workspace',
];
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  agent: BotIcon,
  billing: CreditCardIcon,
  generation: SparklesIcon,
  mention: AtSignIcon,
  pending: ListTodoIcon,
  schedule: CalendarClockIcon,
  system: BellRingIcon,
  workspace: Building2Icon,
};

const InboxModalContent = memo(() => {
  const { i18n, t } = useTranslation('notification');
  const workspaceId = useActiveWorkspaceId();
  const [navigationFilter, setNavigationFilter] = useState(ALL_FILTER);
  const [readStatus, setReadStatus] = useState<ReadStatus>('unread');
  const [bulkAction, setBulkAction] = useState<'archive' | 'read'>();
  const listHandleRef = useRef<NotificationListHandle>(null);
  const registerListHandle = useCallback((handle: NotificationListHandle) => {
    listHandleRef.current = handle;
  }, []);
  // `undefined` = the combined "all" view (no read-state filter).
  const isRead = readStatus === 'all' ? undefined : readStatus === 'read';

  const {
    data: navigationCounts,
    error: navigationCountsError,
    isLoading: isNavigationCountsLoading,
    isValidating: isNavigationCountsValidating,
    mutate: refreshNavigationCounts,
  } = useClientDataSWR<CategoryCount[]>(
    inboxKeys.navigationCounts(workspaceId),
    () => notificationService.getNavigationCounts(),
    { revalidateOnFocus: false },
  );

  // Same key Content uses, so this reads the shared cache entry. The server
  // folds one totalCount unit per live card into `pending`, and archive-all
  // cannot touch live cards — subtracting them yields the archivable rows.
  const { data: liveTransfers } = useClientDataSWR<PendingTransferRequest[]>(
    workspaceId ? [PENDING_TRANSFERS_SWR_KEY, workspaceId] : null,
    () => resourceTransferRequestService.listMine(),
  );
  const liveTransferCount = liveTransfers?.length ?? 0;

  const categoryCounts = navigationCounts ?? [];
  const categoryCountsMap = new Map(categoryCounts.map((item) => [item.category, item]));
  const configuredCategories = workspaceId ? WORKSPACE_INBOX_CATEGORIES : PERSONAL_INBOX_CATEGORIES;
  const categoryLabel = (value: string) =>
    t(`category.${value}`, { defaultValue: value, ns: 'notification' });
  const collator = new Intl.Collator(i18n.resolvedLanguage || i18n.language);
  // Filter extras against the CURRENT context's configured list, not the union
  // of both contexts: a category configured only for the other context (e.g. a
  // personal-scope `workspace` notification) must still get its own entry here.
  const extraCategoryCounts = categoryCounts
    .filter((item) => !configuredCategories.includes(item.category))
    .sort((a, b) => collator.compare(categoryLabel(a.category), categoryLabel(b.category)));
  const visibleCategoryCounts = [
    ...configuredCategories.map(
      (category) =>
        categoryCountsMap.get(category) ?? {
          category,
          readCount: 0,
          totalCount: 0,
          unreadCount: 0,
        },
    ),
    ...extraCategoryCounts,
  ];
  const visibleCategorySignature = visibleCategoryCounts.map((item) => item.category).join('\0');
  const category = navigationFilter === ALL_FILTER ? undefined : navigationFilter;

  useEffect(() => {
    if (
      category &&
      !isNavigationCountsLoading &&
      !navigationCountsError &&
      !visibleCategorySignature.split('\0').includes(category)
    ) {
      setNavigationFilter(ALL_FILTER);
    }
  }, [category, isNavigationCountsLoading, navigationCountsError, visibleCategorySignature]);

  const refreshInbox = useCallback(() => {
    // The notification list lives in a useSWRInfinite hook whose `$inf$` cache
    // key is skipped by SWR's filter-form mutate, so refresh it through the
    // bound handle Content registers instead. This is also the rollback path
    // for optimistic updates: on failure a revalidation restores server state.
    listHandleRef.current?.refresh();
    void mutate(inboxKeys.unreadCount(workspaceId));
    void mutate(inboxKeys.navigationCounts(workspaceId));
  }, [workspaceId]);

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      // A row read in the unread view leaves the list; in the All view it
      // STAYS (as combined history), so removing it there would drop it from
      // the cache until a later refresh — let the revalidation flip its state.
      if (readStatus !== 'all') listHandleRef.current?.optimisticRemove(id);
      try {
        await notificationService.markAsRead([id]);
        refreshInbox();
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
        toast.error(t('inbox.actionFailed'));
        refreshInbox();
      }
    },
    [readStatus, refreshInbox, t],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      listHandleRef.current?.optimisticRemove(id);
      try {
        await notificationService.archive(id);
        refreshInbox();
      } catch (error) {
        console.error('Failed to archive notification:', error);
        toast.error(t('inbox.actionFailed'));
        refreshInbox();
      }
    },
    [refreshInbox, t],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    setBulkAction('read');
    // Rows only leave the unread view when read; in the all view they stay
    // (as read rows), so there the post-action refresh updates them in place.
    if (readStatus === 'unread') listHandleRef.current?.optimisticClear();
    // Pending is action-driven, not read-driven: its badge counts live
    // requests that mark-all-as-read cannot (and must not) resolve. Zeroing
    // it optimistically would flash the count away only to bounce back on the
    // refresh — reading as a broken button — so it stays untouched.
    void refreshNavigationCounts(
      (counts) =>
        counts?.map((item) => (item.category === 'pending' ? item : { ...item, unreadCount: 0 })),
      { revalidate: false },
    );
    try {
      await notificationService.markAllAsRead();
      refreshInbox();
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      toast.error(t('inbox.actionFailed'));
      refreshInbox();
    } finally {
      setBulkAction(undefined);
    }
  }, [readStatus, refreshInbox, refreshNavigationCounts, t]);

  const handleArchiveAll = useCallback(async () => {
    setBulkAction('archive');
    listHandleRef.current?.optimisticClear();
    try {
      await notificationService.archiveAll();
      refreshInbox();
    } catch (error) {
      console.error('Failed to archive all notifications:', error);
      toast.error(t('inbox.actionFailed'));
      refreshInbox();
    } finally {
      setBulkAction(undefined);
    }
  }, [refreshInbox, t]);

  const countForStatus = (item: CategoryCount) => {
    if (readStatus === 'all') return item.totalCount;
    return isRead ? item.readCount : item.unreadCount;
  };
  const allCount = categoryCounts.reduce((total, item) => total + countForStatus(item), 0);
  // Mark-all-read cannot resolve live requests — each live card holds exactly
  // one unit of pending's unreadCount (server reconciliation), so subtracting
  // the card count leaves the rows the action would visibly flip. Ordinary
  // pending rows (personal context has no live cards) stay markable; with
  // only live cards left the button stays off — clicking would change
  // nothing visible and read as a broken button.
  const allUnreadCount = categoryCounts.reduce((total, item) => total + item.unreadCount, 0);
  const markableUnreadCount = Math.max(0, allUnreadCount - liveTransferCount);
  const allTotalCount = categoryCounts.reduce((total, item) => total + item.totalCount, 0);
  // Live cards are not archivable; with only live cards left, archive-all
  // would visibly do nothing — keep it disabled then.
  const archivableTotalCount = Math.max(0, allTotalCount - liveTransferCount);
  return (
    <Flexbox className={styles.root} height={'100%'}>
      <ModalHeader className={styles.header}>
        <Flexbox className={styles.headerTitle} justify="center">
          <ModalTitle>{t('inbox.title')}</ModalTitle>
        </Flexbox>
        <Flexbox
          horizontal
          align="center"
          className={styles.headerMain}
          flex={1}
          justify="space-between"
        >
          <Tabs
            activeKey={readStatus}
            size="small"
            variant="rounded"
            items={[
              { key: 'unread', label: t('inbox.unread') },
              { key: 'read', label: t('inbox.read') },
              { key: 'all', label: t('inbox.allStatus') },
            ]}
            onChange={(key) => setReadStatus(key as ReadStatus)}
          />
          <Flexbox horizontal align="center" gap={4}>
            {readStatus !== 'read' && (
              <Button
                icon={CheckCheckIcon}
                loading={bulkAction === 'read'}
                size="small"
                type="text"
                disabled={
                  markableUnreadCount === 0 ||
                  !!bulkAction ||
                  isNavigationCountsLoading ||
                  !!navigationCountsError
                }
                onClick={handleMarkAllAsRead}
              >
                {t('inbox.markAllRead')}
              </Button>
            )}
            <DropdownMenu
              placement="bottomRight"
              items={[
                {
                  disabled:
                    archivableTotalCount === 0 ||
                    !!bulkAction ||
                    isNavigationCountsLoading ||
                    !!navigationCountsError,
                  icon: ArchiveIcon,
                  key: 'archive-all',
                  label: t('inbox.archiveAll'),
                  onClick: handleArchiveAll,
                },
              ]}
            >
              <ActionIcon
                icon={MoreHorizontalIcon}
                loading={bulkAction === 'archive'}
                size={DESKTOP_HEADER_ICON_SMALL_SIZE}
                title={t('more', { ns: 'common' })}
              />
            </DropdownMenu>
            <ModalClose style={{ position: 'static' }} />
          </Flexbox>
        </Flexbox>
      </ModalHeader>
      <Flexbox horizontal className={styles.body} flex={1}>
        <Flexbox className={styles.sidebar} gap={4}>
          <NavItem
            active={navigationFilter === ALL_FILTER}
            icon={BellIcon}
            title={t('inbox.all')}
            extra={
              allCount > 0 ? (
                <Text style={{ marginInlineEnd: 6 }} type="secondary">
                  {allCount}
                </Text>
              ) : undefined
            }
            onClick={() => setNavigationFilter(ALL_FILTER)}
          />
          <Flexbox className={styles.categoryList} gap={4}>
            {isNavigationCountsLoading ? (
              <SkeletonList rows={4} />
            ) : (
              <>
                {navigationCountsError && (
                  <AsyncError
                    error={navigationCountsError}
                    retrying={isNavigationCountsValidating}
                    variant="inline"
                    onRetry={() => void refreshNavigationCounts()}
                  />
                )}
                {visibleCategoryCounts.map((item) => {
                  const count = countForStatus(item);

                  return (
                    <NavItem
                      active={navigationFilter === item.category}
                      icon={CATEGORY_ICONS[item.category] ?? TagIcon}
                      key={item.category}
                      title={categoryLabel(item.category)}
                      extra={
                        !navigationCountsError && count > 0 ? (
                          <Text style={{ marginInlineEnd: 6 }} type="secondary">
                            {count}
                          </Text>
                        ) : undefined
                      }
                      onClick={() => setNavigationFilter(item.category)}
                    />
                  );
                })}
              </>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox className={styles.main} flex={1}>
          <Flexbox flex={1} style={{ minHeight: 0 }}>
            <Content
              category={category}
              isRead={isRead}
              registerHandle={registerListHandle}
              onArchive={handleArchive}
              onMarkAsRead={handleMarkAsRead}
              onRefreshInbox={refreshInbox}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

InboxModalContent.displayName = 'InboxModalContent';

export const openInboxModal = () =>
  createModal({
    content: <InboxModalContent />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { height: 'min(72dvh, 720px)', overflow: 'hidden', padding: 0 },
    },
    title: false,
    width: 'min(92vw, 920px)',
  });

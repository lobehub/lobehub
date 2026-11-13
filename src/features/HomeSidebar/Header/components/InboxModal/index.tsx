'use client';

import {
  ActionIcon,
  Button,
  createModal,
  DropdownMenu,
  Flexbox,
  ModalClose,
  ModalHeader,
  ModalTitle,
  Tabs,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import dynamic from '@/libs/next/dynamic';
import { mutate } from '@/libs/swr';
import { inboxKeys } from '@/libs/swr/keys';
import { useHomeStore } from '@/store/home';
import { homeNotificationSelectors } from '@/store/home/selectors';
import type { InboxNavigationCount } from '@/store/home/slices/notification/projection';

import { useNavigationCounts } from './useNavigationCounts';

const Content = dynamic(() => import('./Content'), {
  loading: () => (
    <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
      <SkeletonList rows={5} />
    </Flexbox>
  ),
  ssr: false,
});

const styles = stylex.create({
  body: { overflow: 'hidden', minHeight: '0' },
  categoryList: { overflowY: 'auto', overscrollBehavior: 'contain', flex: '1' },
  header: {
    flex: 'none',
    gap: '0',
    padding: '0',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorFillSecondary,
  },
  headerMain: { minWidth: '0', paddingBlock: '12px', paddingInline: '16px' },
  headerTitle: {
    flex: 'none',
    boxSizing: 'border-box',
    width: 'clamp(160px, 22vw, 220px)',
    paddingInline: '16px',
    whiteSpace: 'nowrap',
  },
  main: { overflow: 'hidden', minWidth: '0' },
  root: { overflow: 'hidden' },
  sidebar: {
    overflow: 'hidden',
    flex: 'none',
    boxSizing: 'border-box',
    width: 'clamp(160px, 22vw, 220px)',
    padding: '8px',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorFillSecondary,
  },
});

type CategoryCount = InboxNavigationCount;

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
  // `undefined` = the combined "all" view (no read-state filter).
  const isRead = readStatus === 'all' ? undefined : readStatus === 'read';

  const {
    counts: navigationCounts,
    error: navigationCountsError,
    isConfirmed: isNavigationCountsConfirmed,
    isLoading: isNavigationCountsLoading,
    isValidating: isNavigationCountsValidating,
    retry: refreshNavigationCounts,
  } = useNavigationCounts();

  // The same replica Content reads (one request serves both). The server
  // folds one totalCount unit per live card into `pending`, and archive-all
  // cannot touch live cards — subtracting them yields the archivable rows.
  useHomeStore((s) => s.useFetchPendingTransferRequests)(!!workspaceId);
  const liveTransfers = useHomeStore(homeNotificationSelectors.pendingTransferRequests);
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
    // Only a server answer may drop a category: a restored snapshot can be stale.
    if (
      category &&
      isNavigationCountsConfirmed &&
      !visibleCategorySignature.split('\0').includes(category)
    ) {
      setNavigationFilter(ALL_FILTER);
    }
  }, [category, isNavigationCountsConfirmed, visibleCategorySignature]);

  const refreshInbox = useCallback(() => {
    // Re-reads every mounted inbox view and the counts; a rejected write has
    // already rolled its optimistic change back, so this only reconciles.
    void useHomeStore.getState().refreshInboxNotifications();
    void mutate(inboxKeys.unreadCount(workspaceId));
  }, [workspaceId]);

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      // The row flips to read: the unread view drops it, the All view keeps
      // it (as combined history) in its read state.
      try {
        await useHomeStore.getState().markInboxNotificationRead(id, { category, isRead });
        refreshInbox();
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
        toast.error(t('inbox.actionFailed'));
        refreshInbox();
      }
    },
    [category, isRead, refreshInbox, t],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await useHomeStore.getState().archiveInboxNotification(id, { category, isRead });
        refreshInbox();
      } catch (error) {
        console.error('Failed to archive notification:', error);
        toast.error(t('inbox.actionFailed'));
        refreshInbox();
      }
    },
    [category, isRead, refreshInbox, t],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    setBulkAction('read');
    // Rows leave the unread view and stay (as read rows) in the all view.
    // Pending's badge is left alone: it counts live requests that
    // mark-all-as-read cannot (and must not) resolve.
    try {
      await useHomeStore.getState().markAllInboxNotificationsRead({ category, isRead });
      refreshInbox();
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      toast.error(t('inbox.actionFailed'));
      refreshInbox();
    } finally {
      setBulkAction(undefined);
    }
  }, [category, isRead, refreshInbox, t]);

  const handleArchiveAll = useCallback(async () => {
    setBulkAction('archive');
    try {
      await useHomeStore.getState().archiveAllInboxNotifications({ category, isRead });
      refreshInbox();
    } catch (error) {
      console.error('Failed to archive all notifications:', error);
      toast.error(t('inbox.actionFailed'));
      refreshInbox();
    } finally {
      setBulkAction(undefined);
    }
  }, [category, isRead, refreshInbox, t]);

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
    <Flexbox className={stylex.props(styles.root).className} height={'100%'}>
      <ModalHeader className={stylex.props(styles.header).className}>
        <Flexbox className={stylex.props(styles.headerTitle).className} justify="center">
          <ModalTitle>{t('inbox.title')}</ModalTitle>
        </Flexbox>
        <Flexbox
          horizontal
          align="center"
          className={stylex.props(styles.headerMain).className}
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
      <Flexbox horizontal className={stylex.props(styles.body).className} flex={1}>
        <Flexbox className={stylex.props(styles.sidebar).className} gap={4}>
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
          <Flexbox className={stylex.props(styles.categoryList).className} gap={4}>
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
                        count > 0 ? (
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
        <Flexbox className={stylex.props(styles.main).className} flex={1}>
          <Flexbox flex={1} style={{ minHeight: 0 }}>
            <Content
              category={category}
              isRead={isRead}
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

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
import dynamic from '@/libs/next/dynamic';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { inboxKeys } from '@/libs/swr/keys';
import { notificationService } from '@/services/notification';

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

type ReadStatus = 'read' | 'unread';

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
  'agent',
  'generation',
  'schedule',
  'system',
  'workspace',
];
const KNOWN_INBOX_CATEGORIES = new Set([
  ...PERSONAL_INBOX_CATEGORIES,
  ...WORKSPACE_INBOX_CATEGORIES,
]);
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  agent: BotIcon,
  billing: CreditCardIcon,
  generation: SparklesIcon,
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
  const isRead = readStatus === 'read';

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

  const categoryCounts = navigationCounts ?? [];
  const categoryCountsMap = new Map(categoryCounts.map((item) => [item.category, item]));
  const configuredCategories = workspaceId ? WORKSPACE_INBOX_CATEGORIES : PERSONAL_INBOX_CATEGORIES;
  const categoryLabel = (value: string) =>
    t(`category.${value}`, { defaultValue: value, ns: 'notification' });
  const collator = new Intl.Collator(i18n.resolvedLanguage || i18n.language);
  const extraCategoryCounts = categoryCounts
    .filter((item) => !KNOWN_INBOX_CATEGORIES.has(item.category))
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
      listHandleRef.current?.optimisticRemove(id);
      try {
        await notificationService.markAsRead([id]);
        refreshInbox();
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
        toast.error(t('inbox.actionFailed'));
        refreshInbox();
      }
    },
    [refreshInbox, t],
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
    listHandleRef.current?.optimisticClear();
    void refreshNavigationCounts((counts) => counts?.map((item) => ({ ...item, unreadCount: 0 })), {
      revalidate: false,
    });
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
  }, [refreshInbox, refreshNavigationCounts, t]);

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

  const allCount = categoryCounts.reduce(
    (total, item) => total + (isRead ? item.readCount : item.unreadCount),
    0,
  );
  const allTotalCount = categoryCounts.reduce((total, item) => total + item.totalCount, 0);
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
            ]}
            onChange={(key) => setReadStatus(key as ReadStatus)}
          />
          <Flexbox horizontal align="center" gap={4}>
            {!isRead && (
              <Button
                icon={CheckCheckIcon}
                loading={bulkAction === 'read'}
                size="small"
                type="text"
                disabled={
                  allCount === 0 ||
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
                    allTotalCount === 0 ||
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
                  const count = isRead ? item.readCount : item.unreadCount;

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

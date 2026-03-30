'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BellOffIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRInfinite from 'swr/infinite';
import { VList, type VListHandle } from 'virtua';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { notificationService } from '@/services/notification';

import { FETCH_KEY } from './constants';
import NotificationItem from './NotificationItem';

const PAGE_SIZE = 20;

interface ContentProps {
  onArchive: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  open: boolean;
  unreadOnly?: boolean;
}

const Content = memo<ContentProps>(({ open, unreadOnly, onMarkAsRead, onArchive }) => {
  const { t } = useTranslation('notification');
  const virtuaRef = useRef<VListHandle>(null);

  const getKey = useCallback(
    (pageIndex: number, previousPageData: any[] | null) => {
      if (!open) return null;
      if (previousPageData && previousPageData.length < PAGE_SIZE) return null;

      if (pageIndex === 0) return [FETCH_KEY, undefined, unreadOnly] as const;

      const lastItem = previousPageData?.at(-1);
      return [FETCH_KEY, lastItem?.id, unreadOnly] as const;
    },
    [open, unreadOnly],
  );

  const {
    data: pages,
    isLoading,
    isValidating,
    setSize,
  } = useSWRInfinite(getKey, async ([, cursor, filterUnread]) => {
    return notificationService.list({
      cursor: cursor as string | undefined,
      limit: PAGE_SIZE,
      unreadOnly: filterUnread,
    });
  });

  // Reset scroll position and pagination when filter changes
  useEffect(() => {
    setSize(1);
    virtuaRef.current?.scrollTo(0);
  }, [unreadOnly, setSize]);

  const notifications = pages?.flat() ?? [];
  const hasMore = pages ? pages.at(-1)?.length === PAGE_SIZE : false;

  const handleScroll = useCallback(() => {
    const ref = virtuaRef.current;
    if (!ref || !hasMore || isValidating) return;

    const bottomVisibleIndex = ref.findItemIndex(ref.scrollOffset + ref.viewportSize);
    if (bottomVisibleIndex + 5 > notifications.length) {
      setSize((prev) => prev + 1);
    }
  }, [hasMore, isValidating, notifications.length, setSize]);

  if (isLoading) {
    return (
      <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
        <SkeletonList rows={5} />
      </Flexbox>
    );
  }

  if (notifications.length === 0) {
    return (
      <Flexbox align="center" gap={12} justify="center" paddingBlock={48}>
        <Icon color={cssVar.colorTextQuaternary} icon={BellOffIcon} size={40} />
        <Text type="secondary">{t(unreadOnly ? 'inbox.emptyUnread' : 'inbox.empty')}</Text>
      </Flexbox>
    );
  }

  return (
    <VList ref={virtuaRef} style={{ height: '100%' }} onScroll={handleScroll}>
      {notifications.map((item) => (
        <Flexbox key={item.id} padding="4px 8px">
          <NotificationItem
            actionUrl={item.actionUrl}
            content={item.content}
            createdAt={item.createdAt}
            id={item.id}
            isRead={item.isRead}
            title={item.title}
            type={item.type}
            onArchive={onArchive}
            onMarkAsRead={onMarkAsRead}
          />
        </Flexbox>
      ))}
      {isValidating && (
        <Flexbox padding="4px 8px">
          <SkeletonList rows={2} />
        </Flexbox>
      )}
    </VList>
  );
});

Content.displayName = 'InboxDrawerContent';

export default Content;

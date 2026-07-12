'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Center, Empty, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PackageOpenIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import WorkSummaryCard from '@/features/AgentTasks/features/WorkSummaryCard';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDocumentStore } from '@/store/document';

import { type WorkGalleryKey, workTypeFromKey } from './const';
import { useWorkspaceWorksInfinite } from './hooks';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    height: 100%;
  `,
  header: css`
    flex: none;
    padding-block: 16px 8px;
    padding-inline: 24px;
  `,
  scroll: css`
    overflow: hidden auto;
    flex: 1;

    min-height: 0;
    padding-block: 8px 24px;
    padding-inline: 24px;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
    align-content: start;
  `,
  // Loading placeholder shell that mirrors `WorkSummaryCard` so the skeleton
  // lays out as cards in the same grid, not as full-width list rows.
  skeletonCard: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgElevated};
  `,
  emptyState: css`
    height: 100%;
    min-height: 320px;
  `,
  loadMoreError: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: center;

    padding-block: 16px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  retry: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorTextTertiary};
      color: ${cssVar.colorText};
    }
  `,
}));

/** Card-shaped loading placeholders laid out in the same grid as real cards. */
const SkeletonCards = memo<{ count: number }>(({ count }) => (
  <div className={styles.grid}>
    {Array.from({ length: count }).map((_, index) => (
      <div className={styles.skeletonCard} key={index}>
        <Skeleton.Button
          active
          size={'small'}
          style={{ borderRadius: 8, height: 36, maxWidth: 36, minWidth: 36 }}
        />
        <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
          <Skeleton.Button
            active
            block
            size={'small'}
            style={{ borderRadius: 4, height: 14, maxWidth: '70%' }}
          />
          <Skeleton.Button
            active
            block
            size={'small'}
            style={{ borderRadius: 4, height: 12, maxWidth: '45%', opacity: 0.5 }}
          />
        </Flexbox>
      </div>
    ))}
  </div>
));

SkeletonCards.displayName = 'SkeletonCards';

interface WorkGalleryProps {
  galleryKey: WorkGalleryKey;
}

/**
 * The resource page's 产物 content area: a cross-topic, cursor-paginated card
 * flow of Work summaries for the active workspace / personal scope. Reuses
 * `WorkSummaryCard`, feeding it an `onOpen` that navigates without the chat
 * portal (task → standalone detail route, document → global preview modal,
 * linear / github → external link).
 */
const WorkGallery = memo<WorkGalleryProps>(({ galleryKey }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const openDocumentPreview = useDocumentStore((s) => s.openDocumentPreview);

  const type = workTypeFromKey(galleryKey);
  const { items, error, hasMore, isLoadingInitial, isLoadingMore, loadMore, reload } =
    useWorkspaceWorksInfinite(type);

  const handleOpen = useCallback(
    (item: WorkSummaryItem) => {
      switch (item.type) {
        case 'document': {
          openDocumentPreview(item.document.id);
          return;
        }
        case 'linear': {
          if (item.linear.url) window.open(item.linear.url, '_blank', 'noopener,noreferrer');
          return;
        }
        case 'github': {
          if (item.github.url) window.open(item.github.url, '_blank', 'noopener,noreferrer');
          return;
        }
        // task: no external URL — the standalone detail route resolves the same
        // identifier-or-id the chat portal uses.
        default: {
          navigate(`/task/${item.resourceIdentifier ?? item.resourceId}`);
        }
      }
    },
    [navigate, openDocumentPreview],
  );

  // Infinite scroll: load the next page when a sentinel near the list's end
  // scrolls into view (rootMargin pre-fetches before the user hits the bottom).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) loadMore();
      },
      { rootMargin: '240px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isLoadingMore, loadMore]);

  const renderBody = () => {
    // A failed first fetch must read as an error with a retry — not masquerade
    // as an empty "no works" page.
    if (error && items.length === 0)
      return (
        <Center className={styles.emptyState} gap={12}>
          <Empty
            description={t('work.loadError')}
            icon={TriangleAlertIcon}
            title={t('work.loadErrorTitle')}
          />
          <button className={styles.retry} type={'button'} onClick={() => reload()}>
            {t('work.retry')}
          </button>
        </Center>
      );

    if (isLoadingInitial && items.length === 0) return <SkeletonCards count={6} />;

    if (items.length === 0)
      return (
        <Center className={styles.emptyState}>
          <Empty
            description={t('work.empty.desc')}
            icon={PackageOpenIcon}
            title={t('work.empty.title')}
          />
        </Center>
      );

    return (
      <>
        <div className={styles.grid}>
          {items.map((item) => (
            <WorkSummaryCard item={item} key={item.id} onOpen={handleOpen} />
          ))}
        </div>
        {/* Sentinel drives infinite scroll; keep it mounted so the observer can
            re-fire after each page appends. */}
        <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />
        {isLoadingMore ? (
          <Flexbox style={{ marginBlockStart: 12 }}>
            <SkeletonCards count={2} />
          </Flexbox>
        ) : error ? (
          <div className={styles.loadMoreError}>
            <span>{t('work.loadMoreError')}</span>
            <button className={styles.retry} type={'button'} onClick={() => reload()}>
              {t('work.retry')}
            </button>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <Flexbox className={styles.container}>
      <div className={styles.header}>
        <Text strong style={{ fontSize: 16 }}>
          {t(`work.tab.${galleryKey}`)}
        </Text>
      </div>
      <Flexbox className={styles.scroll}>{renderBody()}</Flexbox>
      <DocumentPreviewModal />
    </Flexbox>
  );
});

WorkGallery.displayName = 'WorkGallery';

export default WorkGallery;

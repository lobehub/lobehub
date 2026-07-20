'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Center, Empty, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PackageOpenIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTaskItemDate } from '@/features/AgentTasks/features/formatTaskItemDate';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDocumentStore } from '@/store/document';

import type { WorkGalleryKey } from './const';
import { useWorkspaceWorksInfinite } from './hooks';
import WorkPreviewCard from './WorkPreviewCard';

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
  // Single-column stack (not a grid): cards keep the library page's fixed
  // proportions and read top-to-bottom within each topic group.
  cardList: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    width: 100%;
    max-width: 420px;
  `,
  groupDate: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  groupHeader: css`
    display: flex;
    gap: 16px;
    align-items: baseline;
    justify-content: space-between;

    margin-block-end: 12px;
  `,
  groupTitle: css`
    overflow: hidden;

    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // Loading placeholder shell that mirrors `WorkPreviewCard` so the skeleton
  // lays out as vertical preview cards in the same grid.
  skeletonCard: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

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
  <div className={styles.cardList}>
    {Array.from({ length: count }).map((_, index) => (
      <div className={styles.skeletonCard} key={index}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Skeleton.Button
            active
            size={'small'}
            style={{ borderRadius: 6, height: 26, maxWidth: 26, minWidth: 26 }}
          />
          <Skeleton.Button
            active
            block
            size={'small'}
            style={{ borderRadius: 4, height: 14, maxWidth: '60%' }}
          />
        </Flexbox>
        <Flexbox gap={8}>
          <Skeleton.Button active block size={'small'} style={{ borderRadius: 4, height: 12 }} />
          <Skeleton.Button
            active
            block
            size={'small'}
            style={{ borderRadius: 4, height: 12, maxWidth: '80%', opacity: 0.7 }}
          />
          <Skeleton.Button
            active
            block
            size={'small'}
            style={{ borderRadius: 4, height: 12, maxWidth: '55%', opacity: 0.4 }}
          />
        </Flexbox>
      </div>
    ))}
  </div>
));

SkeletonCards.displayName = 'SkeletonCards';

/**
 * Initial-load placeholder mirroring the final layout: topic-group sections,
 * each with a title/date header row above its card grid — not a bare card pile.
 */
const SkeletonGroups = memo(() => (
  <Flexbox gap={32}>
    {[3, 2].map((count, index) => (
      <div key={index}>
        <div className={styles.groupHeader}>
          <Skeleton.Button
            active
            size={'small'}
            style={{ borderRadius: 4, height: 16, minWidth: 160, width: 160 }}
          />
          <Skeleton.Button
            active
            size={'small'}
            style={{ borderRadius: 4, height: 12, minWidth: 48, opacity: 0.5, width: 48 }}
          />
        </div>
        <SkeletonCards count={count} />
      </div>
    ))}
  </Flexbox>
));

SkeletonGroups.displayName = 'SkeletonGroups';

interface WorkGalleryProps {
  galleryKey: WorkGalleryKey;
}

/**
 * The resource page's 产物 content area: a cross-topic, cursor-paginated flow
 * of Work previews grouped by origin topic. Renders `WorkPreviewCard` with an
 * `onOpen` that navigates without the chat portal (task → standalone detail
 * route, document → global preview modal, external skill works (linear /
 * github) → external link).
 */
const WorkGallery = memo<WorkGalleryProps>(({ galleryKey }) => {
  const { t, i18n } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const openDocumentPreview = useDocumentStore((s) => s.openDocumentPreview);

  const { items, error, hasMore, isLoadingInitial, isLoadingMore, loadMore, reload } =
    useWorkspaceWorksInfinite(galleryKey);

  // Group the flat (updatedAt desc) page stream by origin topic. First
  // appearance decides group order, so groups sort by their newest work; later
  // pages can still append older works into an already-rendered group.
  const groups = useMemo(() => {
    const byKey = new Map<
      string,
      { items: WorkSummaryItem[]; newestAt: Date; title: string | null }
    >();
    for (const item of items) {
      // Deleted-topic and non-conversation works share one trailing bucket per
      // render order; their titles are gone, so finer keys would only produce
      // several identical "other" sections.
      const key = item.originTopicId ?? '__no_topic__';
      const group = byKey.get(key);
      if (group) group.items.push(item);
      else
        byKey.set(key, {
          items: [item],
          newestAt: item.updatedAt,
          title: item.originTopicTitle ?? null,
        });
    }
    return [...byKey.entries()].map(([key, group]) => ({ key, ...group }));
  }, [items]);

  const handleOpen = useCallback(
    (item: WorkSummaryItem) => {
      const openTarget = getWorkTypeDescriptor(item).getOpenTarget(item);
      if (!openTarget) return;

      switch (openTarget.kind) {
        case 'document': {
          openDocumentPreview(openTarget.documentId);
          return;
        }
        // external skill works (linear / github): external link (URL-less cards
        // yield no target above).
        case 'external': {
          // Defense in depth: only ever hand http(s) to shell.openExternal.
          if (isSafeExternalUrl(openTarget.url))
            window.open(openTarget.url, '_blank', 'noopener,noreferrer');
          return;
        }
        // task: no external URL — the standalone detail route resolves the same
        // identifier-or-id the chat portal uses.
        case 'task': {
          navigate(taskDetailPath(openTarget.identifier));
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

    if (isLoadingInitial && items.length === 0) return <SkeletonGroups />;

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
        <Flexbox gap={32}>
          {groups.map((group) => (
            <div key={group.key}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>
                  {group.title ?? t('work.topicGroup.other')}
                </span>
                <span className={styles.groupDate}>
                  {formatTaskItemDate(group.newestAt, {
                    formatOtherYear: t('time.formatOtherYear', { ns: 'common' }),
                    formatThisYear: t('time.formatThisYear', { ns: 'common' }),
                    locale: i18n.language,
                  })}
                </span>
              </div>
              <div className={styles.cardList}>
                {group.items.map((item) => (
                  <WorkPreviewCard item={item} key={item.id} onOpen={handleOpen} />
                ))}
              </div>
            </div>
          ))}
        </Flexbox>
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
          {t('work.group')}
        </Text>
      </div>
      <Flexbox className={styles.scroll}>{renderBody()}</Flexbox>
      <DocumentPreviewModal />
    </Flexbox>
  );
});

WorkGallery.displayName = 'WorkGallery';

export default WorkGallery;

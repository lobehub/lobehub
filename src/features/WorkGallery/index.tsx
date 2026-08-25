'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Avatar, Center, Empty, Flexbox, Skeleton } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { PackageOpenIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import type { WorkGalleryKey } from './const';
import { useWorkspaceWorksInfinite } from './hooks';
import { useOpenWork } from './useOpenWork';
import WorkPreviewCard from './WorkPreviewCard';

const styles = createStaticStyles(({ css }) => ({
  agentFilter: css`
    flex: none;

    padding-inline: 5px 10px;
    border: 1px solid transparent;
    border-radius: 999px;

    color: ${cssVar.colorTextSecondary};
  `,
  agentFilterActive: css`
    border-color: ${cssVar.colorBorder};
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillQuaternary};
  `,
  cardList: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(280px, 1fr));
    gap: 16px;
    width: 100%;

    @media (width >= 1600px) {
      grid-template-columns: repeat(4, minmax(280px, 1fr));
    }

    @media (width <= 920px) {
      grid-template-columns: repeat(2, minmax(280px, 1fr));
    }

    @media (width <= 620px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  container: css`
    height: 100%;
  `,
  emptyState: css`
    height: 100%;
    min-height: 320px;
  `,
  filterBar: css`
    scrollbar-width: none;

    overflow: auto hidden;
    flex: none;

    padding-block: 12px 10px;
    padding-inline: 24px;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  groupCount: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  groupHeader: css`
    display: flex;
    gap: 10px;
    align-items: baseline;
    margin-block-end: 12px;
  `,
  groupTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
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
  scroll: css`
    overflow: hidden auto;
    flex: 1;

    min-height: 0;
    padding-block: 8px 24px;
    padding-inline: 24px;
  `,
  skeletonCard: css`
    aspect-ratio: 0.9;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface AgentFilterProps {
  active: boolean;
  agentId: string;
  onSelect: (agentId: string) => void;
}

const AgentFilter = memo<AgentFilterProps>(({ active, agentId, onSelect }) => {
  const agent = useAgentDisplayMeta(agentId);
  if (!agent) return null;

  return (
    <Button
      className={cx(styles.agentFilter, active && styles.agentFilterActive)}
      size={'small'}
      type={'text'}
      icon={
        <Avatar
          emojiScaleWithBackground
          avatar={agent.avatar}
          background={agent.backgroundColor}
          shape={'square'}
          size={20}
        />
      }
      onClick={() => onSelect(agentId)}
    >
      {agent.title}
    </Button>
  );
});

AgentFilter.displayName = 'AgentFilter';

const SkeletonCards = memo<{ count: number }>(({ count }) => (
  <div className={styles.cardList}>
    {Array.from({ length: count }).map((_, index) => (
      <div className={styles.skeletonCard} key={index}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    ))}
  </div>
));

SkeletonCards.displayName = 'SkeletonCards';

interface WorkGalleryProps {
  galleryKey: WorkGalleryKey;
}

const WorkGallery = memo<WorkGalleryProps>(({ galleryKey }) => {
  const { t, i18n } = useTranslation('file');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  useFetchAgentList();

  const { items, error, hasMore, isLoadingInitial, isLoadingMore, loadMore, reload } =
    useWorkspaceWorksInfinite(galleryKey);

  const agentIds = useMemo(
    () => [...new Set(items.map((item) => item.originAgentId).filter(Boolean))] as string[],
    [items],
  );
  const filteredItems = useMemo(
    () => (activeAgentId ? items.filter((item) => item.originAgentId === activeAgentId) : items),
    [activeAgentId, items],
  );
  const groups = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const todayKey = dateKey(today);
    const yesterdayKey = dateKey(yesterday);
    const byDate = new Map<string, { items: WorkSummaryItem[]; title: string }>();

    for (const item of filteredItems) {
      const date = new Date(item.updatedAt);
      const key = dateKey(date);
      const title =
        key === todayKey
          ? t('work.date.today')
          : key === yesterdayKey
            ? t('work.date.yesterday')
            : new Intl.DateTimeFormat(i18n.language, {
                day: 'numeric',
                month: 'short',
                year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
              }).format(date);
      const group = byDate.get(key);
      if (group) group.items.push(item);
      else byDate.set(key, { items: [item], title });
    }

    return [...byDate.entries()].map(([key, group]) => ({
      key,
      ...group,
      totalCost: formatWorkVersionCost(
        group.items.reduce((total, item) => total + (item.totalCost || 0), 0),
      ),
    }));
  }, [filteredItems, i18n.language, t]);

  const handleOpen = useOpenWork();

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) loadMore();
      },
      { rootMargin: '240px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadMore]);

  const renderBody = () => {
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

    if (isLoadingInitial && items.length === 0) return <SkeletonCards count={8} />;

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

    if (filteredItems.length === 0)
      return (
        <Center className={styles.emptyState}>
          <Empty description={t('work.agentEmpty.desc')} title={t('work.agentEmpty.title')} />
        </Center>
      );

    return (
      <>
        <Flexbox gap={32}>
          {groups.map((group) => (
            <section key={group.key}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{group.title}</span>
                <span className={styles.groupCount}>
                  {t('work.count', { count: group.items.length })}
                </span>
                {group.totalCost && (
                  <span className={styles.groupCount}>
                    {t('work.totalCost', { cost: group.totalCost })}
                  </span>
                )}
              </div>
              <div className={styles.cardList}>
                {group.items.map((item) => (
                  <WorkPreviewCard item={item} key={item.id} onOpen={handleOpen} />
                ))}
              </div>
            </section>
          ))}
        </Flexbox>
        <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />
        {isLoadingMore ? (
          <Flexbox style={{ marginBlockStart: 12 }}>
            <SkeletonCards count={4} />
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
      {agentIds.length > 0 && (
        <Flexbox horizontal align={'center'} className={styles.filterBar} gap={4}>
          <Button
            className={cx(styles.agentFilter, !activeAgentId && styles.agentFilterActive)}
            size={'small'}
            type={'text'}
            onClick={() => setActiveAgentId(null)}
          >
            {t('work.agentFilter.all')}
          </Button>
          {agentIds.map((agentId) => (
            <AgentFilter
              active={activeAgentId === agentId}
              agentId={agentId}
              key={agentId}
              onSelect={setActiveAgentId}
            />
          ))}
        </Flexbox>
      )}
      <Flexbox className={styles.scroll}>{renderBody()}</Flexbox>
    </Flexbox>
  );
});

WorkGallery.displayName = 'WorkGallery';

export default WorkGallery;

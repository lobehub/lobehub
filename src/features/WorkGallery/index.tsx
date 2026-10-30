'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Avatar, Button, Center, Empty, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PackageOpenIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import CanvasStorageSummary from '@/features/CanvasStorage/Summary';
import {
  summarizeCanvasStorage,
  useFetchCanvasStorage,
} from '@/features/CanvasStorage/useCanvasStorage';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import type { WorkGalleryKey } from './const';
import { useWorkspaceWorksInfinite } from './hooks';
import WorkGallerySkeleton, { WorkGalleryCardsSkeleton } from './Skeleton';
import { useOpenWork } from './useOpenWork';
import WorkPreviewCard from './WorkPreviewCard';
import WorksTypeTabs from './WorksTypeTabs';

const styles = stylex.create({
  agentFilter: {
    flex: 'none',
    paddingInlineStart: '5px',
    paddingInlineEnd: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: '999px',
    color: cssVar.colorTextSecondary,
  },
  agentFilterActive: {
    borderColor: cssVar.colorBorder,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  cardList: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(3, minmax(280px, 1fr))',
      '@media (width >= 1600px)': 'repeat(4, minmax(280px, 1fr))',
      '@media (width <= 920px)': 'repeat(2, minmax(280px, 1fr))',
      '@media (width <= 620px)': 'minmax(0, 1fr)',
    },
    gap: '16px',
    width: '100%',
  },
  container: { height: '100%' },
  emptyState: { height: '100%', minHeight: '320px' },
  filterBar: {
    'scrollbarWidth': 'none',
    'overflowX': 'auto',
    'overflowY': 'hidden',
    'flex': 'none',
    'paddingBlockStart': '12px',
    'paddingBlockEnd': '10px',
    'paddingInline': '24px',
    '::-webkit-scrollbar': { display: 'none' },
  },
  groupCount: { flex: 'none', fontSize: '12px', color: cssVar.colorTextTertiary },
  groupHeader: {
    display: 'flex',
    gap: '10px',
    alignItems: 'baseline',
    marginBlockEnd: '12px',
  },
  groupTitle: { fontSize: '14px', fontWeight: 600, color: cssVar.colorText },
  loadMoreError: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '16px',
    fontSize: '13px',
    color: cssVar.colorTextTertiary,
  },
  retry: {
    cursor: 'pointer',
    paddingBlock: '4px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorTextTertiary },
    borderRadius: '6px',
    fontSize: '13px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  typeBar: { flex: 'none', paddingBlockStart: '12px', paddingBlockEnd: 0, paddingInline: '24px' },
  scroll: {
    overflowX: 'hidden',
    overflowY: 'auto',
    flex: '1',
    minHeight: '0',
    paddingBlockStart: '8px',
    paddingBlockEnd: '24px',
    paddingInline: '24px',
  },
});

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
      className={stylex.props(styles.agentFilter, active && styles.agentFilterActive).className}
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

interface WorkGalleryProps {
  galleryKey: WorkGalleryKey;
}

const WorkGallery = memo<WorkGalleryProps>(({ galleryKey }) => {
  const { t, i18n } = useTranslation('file');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  useFetchAgentList();

  const { items, error, hasMore, isLoadingInitial, isLoadingMore, loadMore, reload } =
    useWorkspaceWorksInfinite(galleryKey);

  // Canvas cards name the file storage they hold; only the caller's own
  // canvases have a size, so a teammate's card simply shows none.
  const hasCanvas = galleryKey === 'canvas' || items.some((item) => item.type === 'canvas');
  const { data: canvasStorage } = useFetchCanvasStorage(hasCanvas);
  const canvasSummary = useMemo(() => summarizeCanvasStorage(canvasStorage), [canvasStorage]);

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
        <Center className={stylex.props(styles.emptyState).className} gap={12}>
          <Empty
            description={t('work.loadError')}
            icon={TriangleAlertIcon}
            title={t('work.loadErrorTitle')}
          />
          <button {...stylex.props(styles.retry)} type={'button'} onClick={() => reload()}>
            {t('work.retry')}
          </button>
        </Center>
      );

    if (items.length === 0)
      return (
        <Center className={stylex.props(styles.emptyState).className}>
          <Empty
            description={t('work.empty.desc')}
            icon={PackageOpenIcon}
            title={t('work.empty.title')}
          />
        </Center>
      );

    if (filteredItems.length === 0)
      return (
        <Center className={stylex.props(styles.emptyState).className}>
          <Empty description={t('work.agentEmpty.desc')} title={t('work.agentEmpty.title')} />
        </Center>
      );

    return (
      <>
        <Flexbox gap={32}>
          {groups.map((group) => (
            <section key={group.key}>
              <div {...stylex.props(styles.groupHeader)}>
                <span {...stylex.props(styles.groupTitle)}>{group.title}</span>
                <span {...stylex.props(styles.groupCount)}>
                  {t('work.count', { count: group.items.length })}
                </span>
                {group.totalCost && (
                  <span {...stylex.props(styles.groupCount)}>
                    {t('work.totalCost', { cost: group.totalCost })}
                  </span>
                )}
              </div>
              <div {...stylex.props(styles.cardList)}>
                {group.items.map((item) => (
                  <WorkPreviewCard
                    item={item}
                    key={item.id}
                    storage={
                      item.resourceId ? canvasSummary.byCanvas.get(item.resourceId) : undefined
                    }
                    onOpen={handleOpen}
                  />
                ))}
              </div>
            </section>
          ))}
        </Flexbox>
        <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />
        {isLoadingMore ? (
          <Flexbox style={{ marginBlockStart: 12 }}>
            <WorkGalleryCardsSkeleton count={4} />
          </Flexbox>
        ) : error ? (
          <div {...stylex.props(styles.loadMoreError)}>
            <span>{t('work.loadMoreError')}</span>
            <button {...stylex.props(styles.retry)} type={'button'} onClick={() => reload()}>
              {t('work.retry')}
            </button>
          </div>
        ) : null}
      </>
    );
  };

  const typeTabs = (
    <Flexbox className={stylex.props(styles.typeBar).className} gap={12}>
      <WorksTypeTabs activeKey={galleryKey} />
      {galleryKey === 'canvas' && <CanvasStorageSummary summary={canvasSummary} />}
    </Flexbox>
  );

  return isLoadingInitial && items.length === 0 ? (
    <Flexbox className={stylex.props(styles.container).className}>
      {typeTabs}
      <WorkGallerySkeleton />
    </Flexbox>
  ) : (
    <Flexbox className={stylex.props(styles.container).className}>
      {typeTabs}
      {agentIds.length > 0 && (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.filterBar).className}
          gap={4}
        >
          <Button
            size={'small'}
            type={'text'}
            className={
              stylex.props(styles.agentFilter, !activeAgentId && styles.agentFilterActive).className
            }
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
      <Flexbox className={stylex.props(styles.scroll).className}>{renderBody()}</Flexbox>
    </Flexbox>
  );
});

WorkGallery.displayName = 'WorkGallery';

export default WorkGallery;

'use client';

import type { PptxViewer, SlideHandle, TextSearchResult } from '@aiden0z/pptx-renderer';
import { Input } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRightIcon, MinusIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';

import PaneFooter from './PaneFooter';

const THUMBNAIL_WIDTH = 74;
const ZOOM_STEP = 10;
const ZOOM_RANGE = [25, 400] as const;

const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  counter: css`
    flex: none;

    min-width: 42px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  pager: css`
    flex: none;

    margin-inline-start: 4px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  scroll: css`
    overflow: auto;
    flex: 1;
    background: ${cssVar.colorBgLayout};
  `,
  searchRow: css`
    display: flex;
    gap: 10px;
    align-items: center;
  `,
  thumb: css`
    display: block;
    width: ${THUMBNAIL_WIDTH}px;
    background: #fff;
  `,
  zoom: css`
    display: flex;
    flex: none;
    align-items: center;
  `,
}));

const SlideThumbnail = memo<{ index: number; viewer: PptxViewer }>(({ index, viewer }) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!container) return;

    let handle: SlideHandle | null = null;
    try {
      handle = viewer.renderThumbnailToContainer(index, container, { width: THUMBNAIL_WIDTH });
    } catch {
      // A slide that cannot be rendered small still has a numbered tab.
    }
    // renderThumbnailToContainer hands ownership of the handle to the caller;
    // destroy() on the viewer does not reclaim externally-rendered slides.
    return () => handle?.dispose();
  }, [container, index, viewer]);

  return <div className={styles.thumb} ref={setContainer} />;
});

SlideThumbnail.displayName = 'SlideThumbnail';

interface PptxPaneProps {
  blob: Blob;
  onError: (error: unknown) => void;
}

const PptxPane = memo<PptxPaneProps>(({ blob, onError }) => {
  const { t } = useTranslation('chat');
  const [loading, setLoading] = useState(true);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<PptxViewer | null>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [fitMode, setFitMode] = useState<'contain' | 'none'>('contain');
  const [zoom, setZoom] = useState(100);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TextSearchResult[]>([]);
  const [hitIndex, setHitIndex] = useState(0);

  useEffect(() => {
    if (!container || !scrollEl) return;

    const controller = new AbortController();
    let instance: PptxViewer | undefined;

    (async () => {
      try {
        const { PptxViewer: Viewer, RECOMMENDED_ZIP_LIMITS } =
          await import('@aiden0z/pptx-renderer');
        if (controller.signal.aborted) return;
        instance = await Viewer.open(blob, container, {
          listOptions: { windowed: true },
          onSlideChange: setCurrentSlide,
          scrollContainer: scrollEl,
          signal: controller.signal,
          // Local files are still untrusted input (agent/tool generated) — cap
          // the ZIP expansion to keep a hostile pptx from exhausting memory.
          zipLimits: RECOMMENDED_ZIP_LIMITS,
        });
        setViewer(instance);
        setSlideCount(instance.slideCount);
        setCurrentSlide(instance.currentSlideIndex);
        setLoading(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        onError(error);
      }
    })();

    return () => {
      controller.abort();
      instance?.destroy();
      setViewer(null);
    };
  }, [blob, container, scrollEl, onError]);

  // Stepping from the current render's `zoom` loses a click when two arrive in
  // one tick, so the step is a functional update and the viewer follows the
  // settled value.
  const stepZoom = useCallback(
    (delta: number) =>
      setZoom((previous) => Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], previous + delta))),
    [],
  );

  useEffect(() => {
    void viewer?.setZoom(zoom);
  }, [viewer, zoom]);

  const goToHit = useCallback(
    async (next: number, results: TextSearchResult[]) => {
      const hit = results[next];
      if (!viewer || !hit) return;
      setHitIndex(next);
      viewer.clearSearchHighlights();
      await viewer.goToSlide(hit.slideIndex);
      await viewer.highlightSearchResult(hit);
    },
    [viewer],
  );

  const runSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (!viewer) return;
      if (!value.trim()) {
        viewer.clearSearchHighlights();
        setHits([]);
        setHitIndex(0);
        return;
      }
      const results = viewer.searchText(value);
      setHits(results);
      void goToHit(0, results);
    },
    [goToHit, viewer],
  );

  const tabs = useMemo(
    () =>
      viewer
        ? Array.from({ length: slideCount }, (_, index) => ({
            key: String(index),
            label: <SlideThumbnail index={index} viewer={viewer} />,
            title: t('workingPanel.localFile.document.slideNumber', { number: index + 1 }),
          }))
        : [],
    [slideCount, t, viewer],
  );

  const note = searching ? (
    <div className={styles.searchRow}>
      <Input
        autoFocus
        placeholder={t('workingPanel.localFile.document.searchPlaceholder')}
        size={'small'}
        value={query}
        variant={'filled'}
        onChange={(event) => runSearch(event.target.value)}
      />
      <span>
        {query.trim() === ''
          ? null
          : hits.length === 0
            ? t('workingPanel.localFile.document.searchEmpty')
            : t('workingPanel.localFile.document.searchHits', {
                current: hitIndex + 1,
                total: hits.length,
              })}
      </span>
      <ActionIcon
        disabled={hits.length === 0}
        icon={ChevronRightIcon}
        size={'small'}
        title={t('workingPanel.localFile.document.searchNext')}
        onClick={() => void goToHit((hitIndex + 1) % hits.length, hits)}
      />
    </div>
  ) : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.scroll} ref={setScrollEl}>
        {loading && <Loading />}
        {/* The viewer owns this node's children — React must never render into it,
            or its bookkeeping breaks when the library replaces the content. */}
        <div ref={setContainer} />
      </div>
      <PaneFooter
        visualTabs
        activeMode={fitMode}
        activeTab={String(currentSlide)}
        note={note}
        tabs={tabs}
        extra={
          <>
            <span className={styles.pager}>
              {slideCount > 0 ? `${currentSlide + 1} / ${slideCount}` : ''}
            </span>
            <div className={styles.zoom}>
              <ActionIcon
                icon={MinusIcon}
                size={'small'}
                title={t('workingPanel.localFile.document.zoomOut')}
                onClick={() => stepZoom(-ZOOM_STEP)}
              />
              <span className={styles.counter}>{zoom}%</span>
              <ActionIcon
                icon={PlusIcon}
                size={'small'}
                title={t('workingPanel.localFile.document.zoomIn')}
                onClick={() => stepZoom(ZOOM_STEP)}
              />
            </div>
            <ActionIcon
              active={searching}
              icon={SearchIcon}
              size={'small'}
              title={t('workingPanel.localFile.document.search')}
              onClick={() => {
                if (searching) runSearch('');
                setSearching(!searching);
              }}
            />
          </>
        }
        modes={[
          { key: 'contain', label: t('workingPanel.localFile.document.fitWidth') },
          { key: 'none', label: t('workingPanel.localFile.document.actualSize') },
        ]}
        onTabChange={(key) => void viewer?.goToSlide(Number(key))}
        onModeChange={(key) => {
          const next = key as 'contain' | 'none';
          setFitMode(next);
          void viewer?.setFitMode(next);
        }}
      />
    </div>
  );
});

PptxPane.displayName = 'PptxPane';

export default PptxPane;

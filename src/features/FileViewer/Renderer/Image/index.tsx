'use client';

import { Center } from '@lobehub/ui';
import { Button, confirmModal, Spin, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getFileDownloadUrl } from '@/features/EditorCanvas/fileDownload';
import { downloadFile } from '@/utils/client/downloadFile';

import { ImageStageContext, type ImageStageValue, type ImageVersion } from './context';
import {
  clampZoom,
  clientToImagePoint,
  fitSize,
  nextRotation,
  type Point,
  type Rotation,
  type Size,
  zoomIn,
  zoomOut,
} from './geometry';
import { EMPTY_MARKUP, type ImageMarkup, isMarkupEmpty } from './Tools/markup';
import TopBar from './TopBar';
import VersionSwitcher from './VersionSwitcher';

/** Room kept around the fitted image so the floating bars do not cover it. */
const STAGE_PADDING = { block: 56, inline: 16 };

const styles = createStaticStyles(({ css }) => ({
  frame: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
  `,
  image: css`
    user-select: none;

    display: block;

    width: 100%;
    height: 100%;

    -webkit-user-drag: none;
  `,
  overlay: css`
    position: absolute;
    inset: 0;
  `,
  root: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    height: 100%;
    min-height: 240px;

    background: ${cssVar.colorFillQuaternary};

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: -2px;
    }
  `,
  stage: css`
    touch-action: none;
    position: absolute;
    inset: 0;
  `,
}));

interface ImageViewerProps {
  fileId: string;
  name?: string;
  /** Host close action; shown in the top bar when provided. */
  onClose?: () => void;
  /**
   * Editing tools slot. Hosts that allow editing mount the tools atom here;
   * read-only hosts (e.g. an unsent chat attachment) leave it empty.
   */
  tools?: ReactNode;
  url: string | null;
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const ImageViewer = ({
  fileId: sourceId,
  name: sourceName,
  onClose,
  tools,
  url: sourceUrl,
}: ImageViewerProps) => {
  const { t } = useTranslation('file');
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panStart = useRef<{ pan: Point; pointer: Point } | null>(null);

  const [overlayElement, setOverlayElement] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'error' | 'loaded' | 'loading'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [naturalSize, setNaturalSize] = useState<Size>();
  const [container, setContainer] = useState<Size>({ height: 0, width: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Edits saved in this session, keyed by the original so a new file starts clean.
  const [versionState, setVersionState] = useState<{
    activeId?: string;
    sourceId: string;
    versions: ImageVersion[];
  }>({ sourceId, versions: [] });
  const { activeId, versions } =
    versionState.sourceId === sourceId ? versionState : { activeId: undefined, versions: [] };
  const active = versions.find((version) => version.fileId === activeId);
  const fileId = active?.fileId ?? sourceId;
  const name = active?.name ?? sourceName;
  const url = active?.url ?? sourceUrl;

  // Unsent marks per version, outside the tools so a version switch (which
  // remounts them while the new image loads) keeps them.
  const [markupByFile, setMarkupByFile] = useState<Record<string, ImageMarkup>>({});
  const [busy, setBusy] = useState(false);
  const markup = markupByFile[fileId] ?? EMPTY_MARKUP;
  const setMarkup = useCallback(
    (next: ImageMarkup | ((current: ImageMarkup) => ImageMarkup)) =>
      setMarkupByFile((state) => ({
        ...state,
        [fileId]: typeof next === 'function' ? next(state[fileId] ?? EMPTY_MARKUP) : next,
      })),
    [fileId],
  );

  const selectVersion = (id?: string) => {
    if (id === active?.fileId) return;
    setStatus('loading');
    setVersionState({ activeId: id, sourceId, versions });
  };

  const addVersion = useCallback(
    (version: ImageVersion) => {
      setVersionState((state) => {
        const current = state.sourceId === sourceId ? state : { sourceId, versions: [] };
        return {
          activeId: version.fileId,
          sourceId,
          versions: [...current.versions.filter((v) => v.fileId !== version.fileId), version],
        };
      });
      setStatus('loading');
    },
    [sourceId],
  );

  // Track the stage size so "fit" follows panel resizes and full screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setContainer({ height: stage.clientHeight, width: stage.clientWidth });
    measure();
    if (!('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const fitToScreen = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const applyZoom = useCallback((next: number) => {
    const zoomValue = clampZoom(next);
    setZoom(zoomValue);
    // Panning only makes sense while the image is larger than the stage.
    if (zoomValue <= 1) setPan({ x: 0, y: 0 });
  }, []);

  // Ctrl/⌘ + wheel zooms, plain wheel pans a zoomed image. Registered natively
  // because React's wheel listener is passive and cannot prevent page scroll.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        applyZoom(zoomRef.current * Math.exp(-event.deltaY * 0.01));
        return;
      }
      if (zoomRef.current <= 1) return;
      event.preventDefault();
      setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen?.();
  }, []);

  // Unsent marks exist only here, so closing would drop them; ask first.
  const handleClose = () => {
    if (!onClose || busy) return;
    const hasMarks = Object.values(markupByFile).some((value) => !isMarkupEmpty(value));
    if (!hasMarks) return onClose();
    confirmModal({
      cancelText: t('imageViewer.cancel'),
      content: t('imageViewer.markup.discardConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('imageViewer.markup.discardConfirm.ok'),
      onOk: onClose,
      title: t('imageViewer.markup.discardConfirm.title'),
    });
  };

  const handleDownload = () => {
    if (!url) return;
    // The `/f/:id` proxy redirects to storage without CORS, so a blob download
    // cannot read it; its `download=1` answer carries an attachment disposition.
    const downloadUrl = getFileDownloadUrl(url, { appOrigin: window.location.origin });
    if (downloadUrl !== url) {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    void downloadFile(url, name || 'image');
  };

  const box = useMemo(() => {
    if (!naturalSize) return { height: 0, width: 0 };
    const fit = fitSize(
      naturalSize,
      {
        height: Math.max(0, container.height - STAGE_PADDING.block * 2),
        width: Math.max(0, container.width - STAGE_PADDING.inline * 2),
      },
      rotation,
    );
    return { height: fit.height * zoom, width: fit.width * zoom };
  }, [container, naturalSize, rotation, zoom]);

  const toImagePoint = useCallback(
    (client: Point) => {
      if (!overlayElement) return;
      return clientToImagePoint(client, overlayElement.getBoundingClientRect(), rotation);
    },
    [overlayElement, rotation],
  );

  const stageValue = useMemo<ImageStageValue | null>(
    () =>
      url
        ? {
            addVersion,
            fileId,
            fitToScreen,
            markup,
            name,
            naturalSize,
            overlayElement,
            rotation,
            setBusy,
            setMarkup,
            toImagePoint,
            url,
            zoom,
          }
        : null,
    [
      addVersion,
      fileId,
      fitToScreen,
      markup,
      name,
      naturalSize,
      overlayElement,
      rotation,
      setMarkup,
      toImagePoint,
      url,
      zoom,
    ],
  );

  if (!url || !stageValue) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case '+':
      case '=': {
        applyZoom(zoomIn(zoom));
        break;
      }
      case '-': {
        applyZoom(zoomOut(zoom));
        break;
      }
      case '0': {
        fitToScreen();
        break;
      }
      default: {
        return;
      }
    }
    event.preventDefault();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || event.button !== 0) return;
    panStart.current = { pan, pointer: { x: event.clientX, y: event.clientY } };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = panStart.current;
    if (!start) return;
    setPan({
      x: start.pan.x + event.clientX - start.pointer.x,
      y: start.pan.y + event.clientY - start.pointer.y,
    });
  };

  const endPan = () => {
    panStart.current = null;
  };

  return (
    <ImageStageContext value={stageValue}>
      <div
        aria-label={name}
        aria-roledescription={'image viewer'}
        className={styles.root}
        data-testid={'image-viewer'}
        ref={rootRef}
        role={'region'}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div
          className={styles.stage}
          ref={stageRef}
          style={{ cursor: zoom > 1 ? 'grab' : undefined }}
          onPointerCancel={endPan}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
        >
          <div
            className={styles.frame}
            style={{
              height: box.height,
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg)`,
              visibility: status === 'loaded' ? 'visible' : 'hidden',
              width: box.width,
            }}
          >
            <img
              alt={name || 'image'}
              className={styles.image}
              draggable={false}
              key={`${url}:${attempt}`}
              src={url}
              onError={() => setStatus('error')}
              onLoad={(event) => {
                const img = event.currentTarget;
                setNaturalSize({ height: img.naturalHeight, width: img.naturalWidth });
                setStatus('loaded');
              }}
            />
            <div
              className={styles.overlay}
              data-testid={'image-viewer-overlay'}
              ref={setOverlayElement}
            />
          </div>
        </div>

        {status === 'loading' && (
          <Center height={'100%'} style={{ inset: 0, position: 'absolute' }} width={'100%'}>
            <Spin size="large" />
          </Center>
        )}
        {status === 'error' && (
          <Center
            gap={12}
            height={'100%'}
            style={{ inset: 0, position: 'absolute' }}
            width={'100%'}
          >
            <Text type={'secondary'}>{t('imageViewer.loadFailed')}</Text>
            <Button
              onClick={() => {
                setStatus('loading');
                setAttempt((value) => value + 1);
              }}
            >
              {t('imageViewer.retry')}
            </Button>
          </Center>
        )}

        <TopBar
          closeDisabled={busy}
          isFullscreen={isFullscreen}
          zoom={zoom}
          onClose={onClose && handleClose}
          onDownload={handleDownload}
          onFit={fitToScreen}
          onRotate={() => setRotation(nextRotation)}
          onToggleFullscreen={toggleFullscreen}
          onZoomIn={() => applyZoom(zoomIn(zoom))}
          onZoomOut={() => applyZoom(zoomOut(zoom))}
        />

        {versions.length > 0 && (
          <VersionSwitcher activeId={active?.fileId} versions={versions} onSelect={selectVersion} />
        )}

        {status === 'loaded' && tools}
      </div>
    </ImageStageContext>
  );
};

export default ImageViewer;

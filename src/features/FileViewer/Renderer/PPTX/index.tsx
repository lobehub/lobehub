'use client';

import {
  PptxViewer,
  type PresentationData,
  RECOMMENDED_ZIP_LIMITS,
  type SlideNode,
} from '@aiden0z/pptx-renderer';
import { Center, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BarChart3,
  Bold,
  Box,
  Copy,
  Download,
  ImagePlus,
  Redo2,
  Save,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { loadPptxDraft, savePptxDraft } from './draftStorage';
import {
  type AddImageOperation,
  editPptx,
  type PptxChartData,
  type PptxEditOperation,
  type PptxElementFrame,
  preparePptxForEditing,
} from './pptxOperations';

const styles = createStaticStyles(({ css }) => ({
  canvas: css`
    position: relative;

    overflow: hidden;
    flex: none;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  canvasHost: css`
    position: absolute;
    inset: 0;
    overflow: hidden;
  `,
  editor: css`
    min-width: 0;
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  error: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorErrorBorder};

    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  overlay: css`
    cursor: move;

    position: absolute;
    z-index: 2;

    border: 1px solid transparent;

    background: transparent;

    &:hover {
      border-color: ${cssVar.colorPrimaryBorderHover};
    }
  `,
  overlaySelected: css`
    border: 2px solid ${cssVar.colorPrimary};
    box-shadow: 0 0 0 1px ${cssVar.colorBgContainer};
  `,
  resizeHandle: css`
    cursor: nwse-resize;

    position: absolute;
    inset-block-end: -7px;
    inset-inline-end: -7px;

    width: 12px;
    height: 12px;
    padding: 0;
    border: 2px solid ${cssVar.colorBgContainer};
    border-radius: 50%;

    background: ${cssVar.colorPrimary};
  `,
  stage: css`
    overflow: auto;
    min-width: 0;
    padding: 32px;
  `,
  status: css`
    min-width: 92px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
  thumbnail: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    width: 144px;
    height: 81px;
    border: 2px solid transparent;
    border-radius: ${cssVar.borderRadiusSM};

    background: ${cssVar.colorBgContainer};
  `,
  thumbnailActive: css`
    border-color: ${cssVar.colorPrimary};
  `,
  thumbnailHost: css`
    pointer-events: none;
    position: absolute;
    inset: 0;
  `,
  thumbnailLabel: css`
    position: absolute;
    z-index: 2;
    inset-block-end: 2px;
    inset-inline-start: 4px;

    padding-block: 0;
    padding-inline: 4px;
    border-radius: 2px;

    font-size: 11px;
    color: white;

    background: rgb(0 0 0 / 55%);
  `,
  thumbnails: css`
    overflow-y: auto;

    width: 176px;
    padding: 16px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  toolbar: css`
    min-height: 48px;
    padding-block: 6px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

interface PPTXEditorProps {
  fileId: string;
  fileName: string;
  url: string;
}

interface RenderedDeck {
  presentation: PresentationData;
  viewer: PptxViewer;
}

const downloadBuffer = (bytes: ArrayBuffer, fileName: string) => {
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith('.pptx') ? fileName : `${fileName}.pptx`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const parseChartInput = (
  categories: string | null,
  values: string | null,
): PptxChartData | null => {
  if (categories === null || values === null) return null;
  const parsedCategories = categories
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const parsedValues = values.split(',').map((value) => Number(value.trim()));
  if (
    parsedCategories.length === 0 ||
    parsedCategories.length !== parsedValues.length ||
    parsedValues.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  return { categories: parsedCategories, values: parsedValues };
};

const defaultFrame = (presentation: PresentationData): PptxElementFrame => ({
  h: presentation.height * 0.25,
  w: presentation.width * 0.45,
  x: presentation.width * 0.275,
  y: presentation.height * 0.375,
});

const Thumbnail = memo<{
  active: boolean;
  index: number;
  onSelect: () => void;
  viewer: PptxViewer;
}>(({ active, index, onSelect, viewer }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    hostRef.current.replaceChildren();
    const handle = viewer.renderThumbnailToContainer(index, hostRef.current, { width: 144 });
    return () => handle?.dispose();
  }, [index, viewer]);
  return (
    <button
      aria-current={active ? 'page' : undefined}
      aria-label={`Slide ${index + 1}`}
      className={`${styles.thumbnail} ${active ? styles.thumbnailActive : ''}`}
      type="button"
      onClick={onSelect}
    >
      <div className={styles.thumbnailHost} ref={hostRef} />
      <span className={styles.thumbnailLabel}>{index + 1}</span>
    </button>
  );
});

Thumbnail.displayName = 'PPTXThumbnail';

const PPTXEditor = memo<PPTXEditorProps>(({ fileId, fileName, url }) => {
  const { t } = useTranslation('file');
  const canvasRef = useRef<HTMLDivElement>(null);
  const renderHostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<ArrayBuffer[]>([]);
  const redoRef = useRef<ArrayBuffer[]>([]);
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [deck, setDeck] = useState<RenderedDeck>();
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>();
  const [historyVersion, setHistoryVersion] = useState(0);
  const [canvasScale, setCanvasScale] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setBusy(true);
      try {
        const draft = await loadPptxDraft(fileId, url);
        const source =
          draft?.bytes || (await (await fetch(url, { signal: controller.signal })).arrayBuffer());
        if (!controller.signal.aborted) {
          setBytes(await preparePptxForEditing(source));
          setDirty(Boolean(draft));
          setError(undefined);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [fileId, url]);

  useEffect(() => {
    if (!bytes) return;
    let active = true;
    const host = document.createElement('div');
    const load = async () => {
      setBusy(true);
      try {
        const viewer = await PptxViewer.open(bytes.slice(0), host, {
          fitMode: 'contain',
          pdfjs: false,
          renderMode: 'slide',
          zipLimits: RECOMMENDED_ZIP_LIMITS,
        });
        const presentation = viewer.presentationData;
        if (!presentation) throw new Error('The presentation could not be parsed');
        if (!active) return viewer.destroy();
        setDeck((previous) => {
          previous?.viewer.destroy();
          return { presentation, viewer };
        });
        setSlideIndex((current) => Math.min(current, presentation.slides.length - 1));
        setSelectedNodeId(undefined);
        setError(undefined);
      } catch (renderError) {
        if (active) setError(renderError);
      } finally {
        if (active) setBusy(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [bytes]);

  useEffect(() => () => deck?.viewer.destroy(), [deck]);

  useEffect(() => {
    if (!deck || !canvasRef.current || !renderHostRef.current) return;
    renderHostRef.current.replaceChildren();
    const width = Math.min(960, Math.max(560, canvasRef.current.parentElement?.clientWidth || 960));
    const scale = width / deck.presentation.width;
    setCanvasScale(scale);
    canvasRef.current.style.width = `${width}px`;
    canvasRef.current.style.height = `${deck.presentation.height * scale}px`;
    const handle = deck.viewer.renderSlideToContainer(slideIndex, renderHostRef.current, scale);
    return () => handle?.dispose();
  }, [deck, slideIndex]);

  const apply = useCallback(
    async (operation: PptxEditOperation | AddImageOperation, history = true) => {
      if (!bytes) return;
      setBusy(true);
      try {
        const next = await editPptx(bytes.slice(0), operation);
        if (history) {
          undoRef.current = [...undoRef.current.slice(-19), bytes];
          redoRef.current = [];
        }
        setBytes(next);
        setDirty(true);
        setHistoryVersion((value) => value + 1);
        await savePptxDraft(fileId, url, next.slice(0));
        setError(undefined);
      } catch (operationError) {
        setError(operationError);
      } finally {
        setBusy(false);
      }
    },
    [bytes, fileId, url],
  );

  const restoreHistory = useCallback(
    async (direction: 'redo' | 'undo') => {
      if (!bytes) return;
      const source = direction === 'undo' ? undoRef : redoRef;
      const target = direction === 'undo' ? redoRef : undoRef;
      const next = source.current.pop();
      if (!next) return;
      target.current.push(bytes);
      setBytes(next);
      setDirty(true);
      setHistoryVersion((value) => value + 1);
      await savePptxDraft(fileId, url, next.slice(0));
    },
    [bytes, fileId, url],
  );

  const save = useCallback(async () => {
    if (!bytes) return;
    setBusy(true);
    try {
      await savePptxDraft(fileId, url, bytes.slice(0));
      setDirty(false);
      setError(undefined);
    } catch (saveError) {
      setError(saveError);
    } finally {
      setBusy(false);
    }
  }, [bytes, fileId, url]);

  const selectedNode = deck?.presentation.slides[slideIndex]?.nodes.find(
    (node) => node.id === selectedNodeId,
  );

  const editText = (node: SlideNode | undefined = selectedNode) => {
    if (!node || node.nodeType !== 'shape') return;
    const current = node.textBody?.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
      .join('\n');
    const text = window.prompt(t('pptxEditor.prompts.text'), current || '');
    if (text !== null) void apply({ nodeId: node.id, slideIndex, text, type: 'setText' });
  };

  const requestChart = (node?: SlideNode) => {
    const categories = window.prompt(t('pptxEditor.prompts.chartCategories'), 'Q1,Q2,Q3,Q4');
    const values = window.prompt(t('pptxEditor.prompts.chartValues'), '18,27,34,42');
    const chart = parseChartInput(categories, values);
    if (!chart) {
      setError(new Error(t('pptxEditor.errors.chartData')));
      return;
    }
    if (node) void apply({ chart, nodeId: node.id, slideIndex, type: 'setChartData' });
    else if (deck)
      void apply({ chart, frame: defaultFrame(deck.presentation), slideIndex, type: 'addChart' });
  };

  const startPointerEdit = (
    event: React.PointerEvent,
    node: SlideNode,
    mode: 'move' | 'resize',
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNodeId(node.id);
    if (!deck || !canvasRef.current) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const scale = canvasRef.current.clientWidth / deck.presentation.width;
    const initial = { ...node.position, ...node.size };
    const onPointerUp = (pointerEvent: PointerEvent) => {
      window.removeEventListener('pointerup', onPointerUp);
      const dx = (pointerEvent.clientX - startX) / scale;
      const dy = (pointerEvent.clientY - startY) / scale;
      const frame =
        mode === 'move'
          ? { h: initial.h, w: initial.w, x: initial.x + dx, y: initial.y + dy }
          : {
              h: Math.max(10, initial.h + dy),
              w: Math.max(10, initial.w + dx),
              x: initial.x,
              y: initial.y,
            };
      void apply({ frame, nodeId: node.id, slideIndex, type: 'setFrame' });
    };
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const addImage = async (file: File) => {
    if (!deck) return;
    await apply({
      bytes: await file.arrayBuffer(),
      fileName: file.name,
      frame: defaultFrame(deck.presentation),
      mimeType: file.type || 'image/png',
      slideIndex,
      type: 'addImage',
    });
  };

  if (error && !bytes)
    return (
      <Center height={'100%'} width={'100%'}>
        <AsyncError error={error} variant="block" onRetry={() => window.location.reload()} />
      </Center>
    );

  if (!deck)
    return (
      <Center height={'100%'} width={'100%'}>
        <NeuralNetworkLoading size={36} />
      </Center>
    );

  const { presentation } = deck;
  const scale = canvasScale;
  const slide = presentation.slides[slideIndex];

  return (
    <Flexbox className={styles.editor}>
      <Flexbox horizontal align="center" className={styles.toolbar} gap={4} justify="space-between">
        <Flexbox horizontal align="center" gap={4}>
          <ActionIcon
            disabled={undoRef.current.length === 0 || busy}
            icon={Undo2}
            title={t('pptxEditor.actions.undo')}
            onClick={() => void restoreHistory('undo')}
          />
          <ActionIcon
            disabled={redoRef.current.length === 0 || busy}
            icon={Redo2}
            title={t('pptxEditor.actions.redo')}
            onClick={() => void restoreHistory('redo')}
          />
          <ActionIcon
            icon={Type}
            title={t('pptxEditor.actions.addText')}
            onClick={() => {
              const text = window.prompt(
                t('pptxEditor.prompts.text'),
                t('pptxEditor.defaults.text'),
              );
              if (text !== null)
                void apply({
                  frame: defaultFrame(presentation),
                  slideIndex,
                  text,
                  type: 'addText',
                });
            }}
          />
          <ActionIcon
            icon={Box}
            title={t('pptxEditor.actions.addShape')}
            onClick={() =>
              void apply({
                fill: '#1677FF',
                frame: defaultFrame(presentation),
                shape: 'roundRect',
                slideIndex,
                type: 'addShape',
              })
            }
          />
          <ActionIcon
            icon={ImagePlus}
            title={t('pptxEditor.actions.addImage')}
            onClick={() => fileInputRef.current?.click()}
          />
          <ActionIcon
            icon={BarChart3}
            title={t('pptxEditor.actions.addChart')}
            onClick={() => requestChart()}
          />
          <input
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp"
            ref={fileInputRef}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addImage(file);
              event.target.value = '';
            }}
          />
          {selectedNode?.nodeType === 'shape' && selectedNode.textBody && (
            <>
              <Button size="small" onClick={() => editText()}>
                {t('pptxEditor.actions.editText')}
              </Button>
              <ActionIcon
                icon={Bold}
                title={t('pptxEditor.actions.bold')}
                onClick={() =>
                  void apply({
                    bold: true,
                    nodeId: selectedNode.id,
                    slideIndex,
                    type: 'formatText',
                  })
                }
              />
              {(
                [
                  ['l', AlignLeft],
                  ['ctr', AlignCenter],
                  ['r', AlignRight],
                ] as const
              ).map(([align, Icon]) => (
                <ActionIcon
                  icon={Icon}
                  key={align}
                  title={t(`pptxEditor.actions.align.${align}`)}
                  onClick={() =>
                    void apply({ align, nodeId: selectedNode.id, slideIndex, type: 'formatText' })
                  }
                />
              ))}
            </>
          )}
          {selectedNode?.nodeType === 'chart' && (
            <Button size="small" onClick={() => requestChart(selectedNode)}>
              {t('pptxEditor.actions.editChart')}
            </Button>
          )}
          {selectedNode && (
            <ActionIcon
              danger
              icon={Trash2}
              title={t('pptxEditor.actions.deleteElement')}
              onClick={() =>
                void apply({ nodeId: selectedNode.id, slideIndex, type: 'deleteElement' })
              }
            />
          )}
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          <span className={styles.status} key={historyVersion}>
            {busy
              ? t('pptxEditor.status.saving')
              : dirty
                ? t('pptxEditor.status.unsaved')
                : t('pptxEditor.status.saved')}
          </span>
          <Button icon={Save} loading={busy} size="small" onClick={() => void save()}>
            {t('pptxEditor.actions.save')}
          </Button>
          <Button
            icon={Download}
            size="small"
            type="primary"
            onClick={() => bytes && downloadBuffer(bytes, fileName)}
          >
            {t('pptxEditor.actions.download')}
          </Button>
        </Flexbox>
      </Flexbox>
      {error !== undefined && (
        <div className={styles.error} role="alert">
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}
      <Flexbox horizontal flex={1} style={{ minHeight: 0 }}>
        <Flexbox className={styles.thumbnails} gap={12}>
          {presentation.slides.map((_, index) => (
            <Thumbnail
              active={slideIndex === index}
              index={index}
              key={index}
              viewer={deck.viewer}
              onSelect={() => setSlideIndex(index)}
            />
          ))}
          <Flexbox horizontal gap={4}>
            <ActionIcon
              icon={Copy}
              title={t('pptxEditor.actions.duplicateSlide')}
              onClick={() => void apply({ slideIndex, type: 'duplicateSlide' })}
            />
            <ActionIcon
              danger
              disabled={presentation.slides.length <= 1}
              icon={Trash2}
              title={t('pptxEditor.actions.deleteSlide')}
              onClick={() => void apply({ slideIndex, type: 'deleteSlide' })}
            />
          </Flexbox>
          <Flexbox horizontal gap={4}>
            <Button
              disabled={slideIndex === 0}
              size="small"
              onClick={() => {
                void apply({ fromIndex: slideIndex, toIndex: slideIndex - 1, type: 'moveSlide' });
                setSlideIndex((value) => value - 1);
              }}
            >
              ↑
            </Button>
            <Button
              disabled={slideIndex === presentation.slides.length - 1}
              size="small"
              onClick={() => {
                void apply({ fromIndex: slideIndex, toIndex: slideIndex + 1, type: 'moveSlide' });
                setSlideIndex((value) => value + 1);
              }}
            >
              ↓
            </Button>
          </Flexbox>
          <select
            aria-label={t('pptxEditor.actions.layout')}
            value={slide.layoutIndex}
            onChange={(event) =>
              void apply({ layoutPath: event.target.value, slideIndex, type: 'setSlideLayout' })
            }
          >
            {Array.from(presentation.layouts.keys()).map((layoutPath, index) => (
              <option key={layoutPath} value={layoutPath}>
                {t('pptxEditor.layout', { index: index + 1 })}
              </option>
            ))}
          </select>
        </Flexbox>
        <Center className={styles.stage} flex={1} onClick={() => setSelectedNodeId(undefined)}>
          <div className={styles.canvas} ref={canvasRef}>
            <div className={styles.canvasHost} ref={renderHostRef} />
            {slide.nodes.map((node) => (
              <button
                aria-label={node.name}
                className={`${styles.overlay} ${selectedNodeId === node.id ? styles.overlaySelected : ''}`}
                key={node.id}
                type="button"
                style={{
                  height: node.size.h * scale,
                  left: node.position.x * scale,
                  top: node.position.y * scale,
                  width: node.size.w * scale,
                }}
                onDoubleClick={() => node.nodeType === 'shape' && node.textBody && editText(node)}
                onPointerDown={(event) => startPointerEdit(event, node, 'move')}
              >
                {selectedNodeId === node.id && (
                  <span
                    aria-label={t('pptxEditor.actions.resize')}
                    className={styles.resizeHandle}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(event) => startPointerEdit(event, node, 'resize')}
                  />
                )}
              </button>
            ))}
          </div>
        </Center>
      </Flexbox>
    </Flexbox>
  );
});

PPTXEditor.displayName = 'PPTXEditor';

export default PPTXEditor;

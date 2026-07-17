'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { ActionIcon, Flexbox, Text, TextArea } from '@lobehub/ui';
import {
  Button,
  createModal,
  Modal,
  type ModalInstance,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { t } from 'i18next';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AnnotationCanvas } from './Annotation';

const styles = createStaticStyles(({ css }) => ({
  canvasWrap: css`
    position: relative;

    .acceptance-annotate-fullscreen {
      position: absolute;
      z-index: 5;
      inset-block-start: 8px;
      inset-inline-end: 8px;

      border: 1px solid ${cssVar.colorBorderSecondary};

      opacity: 0;
      background: ${cssVar.colorBgContainer};

      transition: opacity 0.2s;
    }

    &:hover {
      .acceptance-annotate-fullscreen {
        opacity: 1;
      }
    }
  `,
  fullscreenBody: css`
    display: flex;
    flex: 1;
    gap: 16px;
    min-height: 0;
  `,
  regionIndex: css`
    flex: none;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    color: #fff;
    text-align: center;

    background: ${cssVar.colorError};
  `,
  sidePanel: css`
    overflow-y: auto;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 12px;

    width: 320px;
    min-width: 0;
  `,
  thumb: css`
    cursor: pointer;

    overflow: hidden;

    width: 72px;
    height: 48px;
    border: 2px solid transparent;
    border-radius: ${cssVar.borderRadius};

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
  thumbActive: css`
    border-color: ${cssVar.colorPrimary};
  `,
  /** The fullscreen zoom stage — its native scrolling doubles as panning. */
  viewport: css`
    overflow: auto;
    flex: 1;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  zoomLabel: css`
    min-width: 44px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
}));

/** One annotatable evidence image (already filtered to visual, file-backed). */
export interface RejectableEvidence {
  fileUrl: string;
  id: string;
}

interface DraftAnnotationEntry {
  comment: string;
  evidenceId: string;
  /** Stable identity — rapid move/resize updates must never key off object
      identity, which a stale render closure invalidates mid-gesture. */
  key: number;
  rect: AcceptanceReviewAnnotation['rect'];
}

let draftAnnotationSeq = 0;
const nextAnnotationKey = () => ++draftAnnotationSeq;

/** What survives a refresh — typed feedback is too costly to lose to one F5. */
interface RejectDraft {
  annotations: DraftAnnotationEntry[];
  comment: string;
}

const draftStorageKey = (key: string) => `acceptance-reject-draft:${key}`;

const readDraft = (key: string | undefined): RejectDraft | null => {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(draftStorageKey(key));
    return raw ? (JSON.parse(raw) as RejectDraft) : null;
  } catch {
    return null;
  }
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

interface CheckRejectModalProps {
  checkTitle: string;
  /** Stable key (the check id) for the refresh-surviving draft cache. */
  draftKey?: string;
  evidence: RejectableEvidence[];
  /** Perform the reject; resolve true to close, false to stay open. */
  onConfirm: (value: {
    annotations: AcceptanceReviewAnnotation[];
    comment: string;
  }) => Promise<boolean>;
}

const CheckRejectContent = memo<CheckRejectModalProps>(
  ({ checkTitle, draftKey, evidence, onConfirm }) => {
    const { t: translate } = useTranslation('verify');
    const { close } = useModalContext();
    const [draft] = useState(() => readDraft(draftKey));
    const [comment, setComment] = useState(draft?.comment ?? '');
    const [loading, setLoading] = useState(false);
    const [activeEvidenceId, setActiveEvidenceId] = useState(evidence[0]?.id);
    const [annotations, setAnnotations] = useState<DraftAnnotationEntry[]>(
      // Only restore regions whose evidence still exists — a new round may
      // have replaced the artifacts since the draft was written.
      () =>
        (draft?.annotations ?? [])
          .filter((entry) => evidence.some((item) => item.id === entry.evidenceId))
          .map((entry) => ({ ...entry, key: nextAnnotationKey() })),
    );

    // Fullscreen inspect-and-annotate: same draft state, a zoomable stage.
    const [fullscreen, setFullscreen] = useState(false);
    const [zoom, setZoom] = useState(1);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState<number>();

    useLayoutEffect(() => {
      if (!fullscreen) return;
      let observer: ResizeObserver | undefined;
      let raf = 0;
      // The Modal body mounts async (portal + open animation), so the ref may
      // be null on the first pass — retry on the next frame until it attaches,
      // then track its width. Without this the image stays fit-width and zoom
      // does nothing (viewportWidth never resolves).
      const attach = () => {
        const node = viewportRef.current;
        if (!node) {
          raf = requestAnimationFrame(attach);
          return;
        }
        const measure = () => setViewportWidth(node.clientWidth);
        measure();
        observer = new ResizeObserver(measure);
        observer.observe(node);
      };
      attach();
      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
      };
    }, [fullscreen, activeEvidenceId]);

    // Persist the draft as it is typed; an empty draft cleans the slot up.
    useEffect(() => {
      if (!draftKey) return;
      try {
        if (!comment && annotations.length === 0) {
          localStorage.removeItem(draftStorageKey(draftKey));
        } else {
          localStorage.setItem(
            draftStorageKey(draftKey),
            JSON.stringify({ annotations, comment } satisfies RejectDraft),
          );
        }
      } catch {
        /* quota/private mode — the draft is a convenience, never a blocker */
      }
    }, [annotations, comment, draftKey]);

    const activeEvidence = evidence.find((item) => item.id === activeEvidenceId);
    const activeAnnotations = annotations.filter((item) => item.evidenceId === activeEvidenceId);

    const stepZoom = (direction: 1 | -1) =>
      setZoom((current) => {
        const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.001);
        const at = index === -1 ? 2 : index;
        return ZOOM_STEPS[Math.min(Math.max(at + direction, 0), ZOOM_STEPS.length - 1)];
      });

    // The reject IS its feedback — at least one note (global or per-region).
    const canSubmit =
      Boolean(comment.trim()) || annotations.some((annotation) => annotation.comment.trim());

    const handleConfirm = async () => {
      setLoading(true);
      try {
        const confirmed = await onConfirm({
          annotations: annotations
            .filter((annotation) => annotation.comment.trim())
            .map((annotation) => ({
              comment: annotation.comment.trim(),
              evidenceId: annotation.evidenceId,
              rect: annotation.rect,
            })),
          comment: comment.trim(),
        });
        if (confirmed) {
          if (draftKey) localStorage.removeItem(draftStorageKey(draftKey));
          close();
        }
      } finally {
        setLoading(false);
      }
    };

    const hasEvidence = evidence.length > 0;

    const canvasHandlers = {
      onDraw: (rect: AcceptanceReviewAnnotation['rect']) =>
        setAnnotations((previous) => [
          ...previous,
          { comment: '', evidenceId: activeEvidence!.id, key: nextAnnotationKey(), rect },
        ]),
      onRemove: (index: number) => {
        const target = activeAnnotations[index];
        if (target)
          setAnnotations((previous) => previous.filter((item) => item.key !== target.key));
      },
      onUpdate: (index: number, rect: AcceptanceReviewAnnotation['rect']) => {
        const target = activeAnnotations[index];
        if (target)
          setAnnotations((previous) =>
            previous.map((item) => (item.key === target.key ? { ...item, rect } : item)),
          );
      },
    };

    const annotationInputs = activeAnnotations.map((annotation, index) => (
      <Flexbox horizontal align={'flex-start'} gap={8} key={annotation.key}>
        <span className={styles.regionIndex} style={{ marginBlockStart: 6 }}>
          {index + 1}
        </span>
        <TextArea
          autoSize={{ maxRows: 5, minRows: 1 }}
          style={{ flex: 1 }}
          value={annotation.comment}
          placeholder={translate('acceptance.review.annotationPlaceholder', {
            index: index + 1,
          })}
          onChange={(event) =>
            setAnnotations((previous) =>
              previous.map((item) =>
                item.key === annotation.key ? { ...item, comment: event.target.value } : item,
              ),
            )
          }
        />
      </Flexbox>
    ));

    const thumbnails = evidence.length > 1 && (
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {evidence.map((item) => (
          <div
            className={cx(styles.thumb, item.id === activeEvidenceId && styles.thumbActive)}
            key={item.id}
            onClick={() => setActiveEvidenceId(item.id)}
          >
            <img alt={''} src={item.fileUrl} />
          </div>
        ))}
      </Flexbox>
    );

    return (
      <>
        {/* Only the body scrolls — the action bar below stays pinned to the
          modal's bottom edge however tall the evidence grows. */}
        <Flexbox
          flex={1}
          gap={16}
          paddingBlock={12}
          paddingInline={16}
          style={{ minHeight: 0, overflowY: 'auto' }}
        >
          <Text fontSize={13} type={'secondary'}>
            {translate('acceptance.review.rejectDescription', { title: checkTitle })}
          </Text>

          {/* Circling the evidence is the primary feedback act; region notes
              sit right under the canvas. Fullscreen opens the zoomable stage
              for pixel-level inspection on large screenshots. */}
          {hasEvidence && (
            <Flexbox gap={8}>
              <Flexbox gap={2}>
                <Text strong fontSize={13}>
                  {translate('acceptance.review.annotate')}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {translate('acceptance.review.annotateHint')}
                </Text>
              </Flexbox>
              {thumbnails}
              {activeEvidence && (
                <div className={styles.canvasWrap}>
                  <AnnotationCanvas
                    annotations={activeAnnotations}
                    src={activeEvidence.fileUrl}
                    {...canvasHandlers}
                  />
                  <ActionIcon
                    className={'acceptance-annotate-fullscreen'}
                    icon={Maximize2}
                    size={'small'}
                    title={translate('acceptance.review.fullscreen')}
                    onClick={() => {
                      setZoom(1);
                      setFullscreen(true);
                    }}
                  />
                </div>
              )}
              {annotationInputs}
            </Flexbox>
          )}

          <Flexbox gap={6}>
            {hasEvidence && (
              <Text fontSize={12} type={'secondary'}>
                {translate('acceptance.review.supplement')}
              </Text>
            )}
            <TextArea
              autoSize={{ maxRows: 6, minRows: hasEvidence ? 2 : 3 }}
              placeholder={translate('acceptance.review.rejectPlaceholder')}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Flexbox>
        </Flexbox>

        <Flexbox
          horizontal
          gap={8}
          justify={'flex-end'}
          paddingBlock={12}
          paddingInline={16}
          style={{ borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}`, flex: 'none' }}
        >
          <Button disabled={loading} onClick={close}>
            {translate('acceptance.actions.cancel')}
          </Button>
          <Button disabled={!canSubmit} loading={loading} type={'primary'} onClick={handleConfirm}>
            {translate('acceptance.review.confirmReject')}
          </Button>
        </Flexbox>

        {/* Fullscreen inspect-and-annotate stage — a base-ui Modal so the mask,
            theme scope and stacking are handled by the same layer system as
            the reject dialog it opens over (nested modals stack correctly).
            Same draft state: zoom via the toolbar, pan via the viewport's
            native scroll. */}
        <Modal
          centered
          destroyOnHidden
          footer={null}
          height={'88vh'}
          open={fullscreen}
          title={translate('acceptance.review.annotate')}
          width={'min(96vw, 1440px)'}
          styles={{
            body: {
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              height: '100%',
              minHeight: 0,
              paddingBlock: 12,
            },
          }}
          onCancel={() => setFullscreen(false)}
        >
          {activeEvidence && (
            <>
              <Flexbox horizontal align={'center'} gap={8}>
                <Text fontSize={12} type={'secondary'}>
                  {translate('acceptance.review.annotateHint')}
                </Text>
                <Flexbox flex={1} />
                <ActionIcon
                  disabled={zoom <= ZOOM_STEPS[0]}
                  icon={ZoomOut}
                  size={'small'}
                  title={translate('acceptance.review.zoomOut')}
                  onClick={() => stepZoom(-1)}
                />
                <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
                <ActionIcon
                  disabled={zoom >= ZOOM_STEPS.at(-1)!}
                  icon={ZoomIn}
                  size={'small'}
                  title={translate('acceptance.review.zoomIn')}
                  onClick={() => stepZoom(1)}
                />
              </Flexbox>
              {thumbnails}
              <div className={styles.fullscreenBody}>
                <div className={styles.viewport} ref={viewportRef}>
                  <AnnotationCanvas
                    annotations={activeAnnotations}
                    src={activeEvidence.fileUrl}
                    imageWidth={
                      // -2 keeps the frame's own border inside the viewport at
                      // fit zoom, so no phantom horizontal scrollbar.
                      viewportWidth ? Math.max(viewportWidth * zoom - 2, 0) : undefined
                    }
                    {...canvasHandlers}
                  />
                </div>
                <div className={styles.sidePanel}>
                  <Text strong fontSize={13}>
                    {translate('acceptance.review.regionComments')}
                  </Text>
                  {activeAnnotations.length === 0 && (
                    <Text fontSize={12} type={'secondary'}>
                      {translate('acceptance.review.regionCommentsEmpty')}
                    </Text>
                  )}
                  {annotationInputs}
                </div>
              </div>
            </>
          )}
        </Modal>
      </>
    );
  },
);

CheckRejectContent.displayName = 'AcceptanceCheckRejectContent';

/** Per-check reject dialog — a note plus circled regions; fullscreen zoom to inspect. */
export const openCheckRejectModal = (options: CheckRejectModalProps): ModalInstance =>
  createModal({
    content: <CheckRejectContent {...options} />,
    footer: null,
    maskClosable: true,
    // The content region hosts its own scroll body + pinned action bar — it
    // must not scroll (or pad) as a whole, or the bar scrolls away with it.
    styles: {
      content: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        padding: 0,
      },
    },
    title: t('acceptance.review.reject', { ns: 'verify' }),
    width: 'min(92vw, 640px)',
  });

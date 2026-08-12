'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { ActionIcon, Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AnnotationCanvas } from './Annotation';
import { AttachmentStrip, AttachmentUploadButton, useFeedbackAttachments } from './attachments';
import { frostedModalStyles } from './modals';

const styles = createStaticStyles(({ css }) => ({
  modalPopup: css`
    > div {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
  `,
  fullscreenBody: css`
    display: flex;
    flex: 1;
    gap: 16px;
    min-height: 0;

    @media (width <= 640px) {
      flex-direction: column;
      gap: 12px;
    }
  `,
  modalBody: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  modalFooter: css`
    flex: none;
    padding-block: 12px;
    padding-inline: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
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

    @media (width <= 640px) {
      flex: 0 1 auto;
      width: 100%;
      max-height: 36%;
    }
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
  /** The fullscreen zoom stage — its native scrolling doubles as panning.
      Flex + the inner frame's `margin: auto` keeps the image centered when it
      fits the stage, and scrolls from the edges once it grows past it. */
  viewport: css`
    overflow: auto;
    display: flex;
    flex: 1;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  /** The centered image frame inside the stage — `margin: auto` absorbs the
      free space on both axes (centering) and collapses to 0 on overflow. */
  viewportInner: css`
    margin: auto;
  `,
  /** The zoom pill floats bottom-center over the stage — controls live with
      the thing they control, not in a detached toolbar row. */
  zoomBar: css`
    position: absolute;
    z-index: 5;
    inset-block-end: 16px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 99px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
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

export const CHECK_REJECT_MODAL_SIZE = { height: '98dvh', width: '98vw' } as const;

export const rejectModalTitle = (title: string, description?: string) => ({
  description: description?.trim() || undefined,
  title,
});

export const canDismissRejectModal = (loading: boolean) => !loading;

interface CheckRejectModalProps {
  checkDescription?: string;
  checkTitle: string;
  /** Stable key (the check id) for the refresh-surviving draft cache. */
  draftKey?: string;
  evidence: RejectableEvidence[];
  /** Feedback already typed in the focused detail before opening annotation. */
  initialComment?: string;
  /** Perform the reject; resolve true to close, false to stay open. */
  onConfirm: (value: {
    annotations: AcceptanceReviewAnnotation[];
    comment: string;
    fileIds: string[];
  }) => Promise<boolean>;
}

export const mergeRejectComments = (initialComment = '', storedComment = '') => {
  const initial = initialComment.trim();
  const stored = storedComment.trim();
  if (!initial) return stored;
  if (!stored || stored === initial) return initial;
  return `${initial}\n\n${stored}`;
};

const CheckRejectModalContent = memo<CheckRejectModalProps>(
  ({ checkTitle, draftKey, evidence, initialComment, onConfirm }) => {
    const { t: translate } = useTranslation('verify');
    const { close, setCanDismissByClickOutside } = useModalContext();
    const [draft] = useState(() => readDraft(draftKey));
    const [comment, setComment] = useState(() =>
      mergeRejectComments(initialComment, draft?.comment),
    );
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

    useEffect(() => {
      setCanDismissByClickOutside(canDismissRejectModal(loading));
    }, [loading, setCanDismissByClickOutside]);

    // Your own screenshots (paste or upload) — attached to the reject alongside
    // the note and any circled regions.
    const { attachments, fileIds, handlePaste, remove, uploadFiles, uploading } =
      useFeedbackAttachments();

    const [zoom, setZoom] = useState(1);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState<number>();
    useLayoutEffect(() => {
      if (evidence.length === 0) return;
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
    }, [activeEvidenceId, evidence.length]);

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

    // The reject IS its feedback — at least one note (global or per-region) or
    // an attached screenshot the next round can act on.
    const canSubmit =
      Boolean(comment.trim()) ||
      annotations.some((annotation) => annotation.comment.trim()) ||
      fileIds.length > 0;

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
          fileIds,
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

    const footer = (
      <Flexbox gap={10} style={{ width: '100%' }}>
        <Text fontSize={12} type={'secondary'}>
          {hasEvidence
            ? translate('acceptance.review.supplement')
            : translate('acceptance.review.rejectDescription', { title: checkTitle })}
        </Text>
        <TextArea
          autoSize={{ maxRows: 5, minRows: 2 }}
          placeholder={translate('acceptance.review.rejectPlaceholder')}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onPaste={handlePaste}
        />
        <Flexbox horizontal align={'flex-start'} gap={8}>
          <Flexbox horizontal flex={1} gap={8}>
            <AttachmentUploadButton disabled={loading} onFiles={uploadFiles} />
            <AttachmentStrip
              attachments={attachments}
              disabled={loading}
              uploading={uploading}
              onRemove={remove}
            />
          </Flexbox>
          <Button disabled={loading} onClick={close}>
            {translate('acceptance.actions.cancel')}
          </Button>
          <Button
            disabled={!canSubmit || uploading}
            loading={loading}
            type={'primary'}
            onClick={handleConfirm}
          >
            {translate('acceptance.review.confirmReject')}
          </Button>
        </Flexbox>
      </Flexbox>
    );

    return (
      <div className={styles.modalBody}>
        <Flexbox flex={1} gap={12} padding={hasEvidence ? 16 : 20} style={{ minHeight: 0 }}>
          {activeEvidence ? (
            <Flexbox gap={12} height={'100%'} style={{ minHeight: 0 }}>
              {thumbnails}
              <div className={styles.fullscreenBody} style={{ position: 'relative' }}>
                <div className={styles.viewport} ref={viewportRef}>
                  <div className={styles.viewportInner}>
                    <AnnotationCanvas
                      annotations={activeAnnotations}
                      imageWidth={viewportWidth ? Math.max(viewportWidth * zoom - 2, 0) : undefined}
                      src={activeEvidence.fileUrl}
                      {...canvasHandlers}
                    />
                  </div>
                </div>
                <div className={styles.zoomBar}>
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
                </div>
                <div className={styles.sidePanel}>
                  <Flexbox gap={2}>
                    <Text strong fontSize={13}>
                      {translate('acceptance.review.regionComments')}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {translate('acceptance.review.annotateHint')}
                    </Text>
                  </Flexbox>
                  {activeAnnotations.length === 0 && (
                    <Text fontSize={12} type={'secondary'}>
                      {translate('acceptance.review.regionCommentsEmpty')}
                    </Text>
                  )}
                  {annotationInputs}
                </div>
              </div>
            </Flexbox>
          ) : (
            <Text fontSize={13} type={'secondary'}>
              {translate('acceptance.review.rejectDescription', { title: checkTitle })}
            </Text>
          )}
        </Flexbox>
        <div className={styles.modalFooter}>{footer}</div>
      </div>
    );
  },
);

CheckRejectModalContent.displayName = 'AcceptanceCheckRejectModalContent';

/** Per-check reject modal — media gets a near-fullscreen annotation surface without losing context. */
export const openCheckRejectModal = (options: CheckRejectModalProps) => {
  const modalTitle = rejectModalTitle(options.checkTitle, options.checkDescription);

  return createModal({
    classNames: { popup: styles.modalPopup },
    content: <CheckRejectModalContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: {
      ...frostedModalStyles,
      content: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 },
      popup: {
        display: 'flex',
        flexDirection: 'column',
        height: CHECK_REJECT_MODAL_SIZE.height,
        maxWidth: CHECK_REJECT_MODAL_SIZE.width,
      },
    },
    title: (
      <Flexbox gap={2}>
        <Text strong>{modalTitle.title}</Text>
        {modalTitle.description && (
          <Text fontSize={12} type={'secondary'}>
            {modalTitle.description}
          </Text>
        )}
      </Flexbox>
    ),
    width: CHECK_REJECT_MODAL_SIZE.width,
  });
};

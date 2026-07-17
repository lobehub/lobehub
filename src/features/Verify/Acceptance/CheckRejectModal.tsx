'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { t } from 'i18next';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AnnotationCanvas } from './Annotation';

const styles = createStaticStyles(({ css }) => ({
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

          {/* Circling the evidence is the primary feedback act; the free-form note
          below is supplementary context. Without evidence, the note IS the
          feedback and stands alone. */}
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
              {evidence.length > 1 && (
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  {evidence.map((item) => (
                    <div
                      key={item.id}
                      className={cx(
                        styles.thumb,
                        item.id === activeEvidenceId && styles.thumbActive,
                      )}
                      onClick={() => setActiveEvidenceId(item.id)}
                    >
                      <img alt={''} src={item.fileUrl} />
                    </div>
                  ))}
                </Flexbox>
              )}
              {activeEvidence && (
                <AnnotationCanvas
                  annotations={activeAnnotations}
                  src={activeEvidence.fileUrl}
                  onDraw={(rect) =>
                    setAnnotations((previous) => [
                      ...previous,
                      {
                        comment: '',
                        evidenceId: activeEvidence.id,
                        key: nextAnnotationKey(),
                        rect,
                      },
                    ])
                  }
                  onRemove={(index) => {
                    const target = activeAnnotations[index];
                    if (target)
                      setAnnotations((previous) =>
                        previous.filter((item) => item.key !== target.key),
                      );
                  }}
                  onUpdate={(index, rect) => {
                    const target = activeAnnotations[index];
                    if (target)
                      setAnnotations((previous) =>
                        previous.map((item) =>
                          item.key === target.key ? { ...item, rect } : item,
                        ),
                      );
                  }}
                />
              )}
              {activeAnnotations.map((annotation, index) => {
                return (
                  <Flexbox horizontal align={'flex-start'} gap={8} key={annotation.key}>
                    <Text
                      fontSize={12}
                      style={{ flex: 'none', lineHeight: '30px' }}
                      type={'secondary'}
                    >
                      {index + 1}.
                    </Text>
                    <TextArea
                      autoSize={{ maxRows: 4, minRows: 1 }}
                      style={{ flex: 1 }}
                      value={annotation.comment}
                      placeholder={translate('acceptance.review.annotationPlaceholder', {
                        index: index + 1,
                      })}
                      onChange={(event) =>
                        setAnnotations((previous) =>
                          previous.map((item) =>
                            item.key === annotation.key
                              ? { ...item, comment: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Flexbox>
                );
              })}
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
      </>
    );
  },
);

CheckRejectContent.displayName = 'AcceptanceCheckRejectContent';

/** Per-check reject dialog — a note plus optional circled regions on evidence. */
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

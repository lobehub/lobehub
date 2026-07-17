'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { t } from 'i18next';
import { memo, useState } from 'react';
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

interface CheckRejectModalProps {
  checkTitle: string;
  evidence: RejectableEvidence[];
  /** Perform the reject; resolve true to close, false to stay open. */
  onConfirm: (value: {
    annotations: AcceptanceReviewAnnotation[];
    comment: string;
  }) => Promise<boolean>;
}

const CheckRejectContent = memo<CheckRejectModalProps>(({ checkTitle, evidence, onConfirm }) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState(evidence[0]?.id);
  const [annotations, setAnnotations] = useState<
    { comment: string; evidenceId: string; rect: AcceptanceReviewAnnotation['rect'] }[]
  >([]);

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
      if (confirmed) close();
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
                    className={cx(styles.thumb, item.id === activeEvidenceId && styles.thumbActive)}
                    key={item.id}
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
                    { comment: '', evidenceId: activeEvidence.id, rect },
                  ])
                }
                onRemove={(index) =>
                  setAnnotations((previous) =>
                    previous.filter((item) => item !== activeAnnotations[index]),
                  )
                }
              />
            )}
            {activeAnnotations.map((annotation, index) => {
              const globalIndex = annotations.indexOf(annotation);
              return (
                <Input
                  key={globalIndex}
                  value={annotation.comment}
                  placeholder={translate('acceptance.review.annotationPlaceholder', {
                    index: index + 1,
                  })}
                  prefix={
                    <Text fontSize={12} type={'secondary'}>
                      {index + 1}.
                    </Text>
                  }
                  onChange={(event) =>
                    setAnnotations((previous) =>
                      previous.map((item) =>
                        item === annotation ? { ...item, comment: event.target.value } : item,
                      ),
                    )
                  }
                />
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
});

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

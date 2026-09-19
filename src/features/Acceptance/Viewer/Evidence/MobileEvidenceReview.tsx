'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Segmented, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ZOOM_STEPS } from '../Review/rejectDraft';
import type { RejectReviewModel } from '../Review/useRejectReview';
import { AttachmentStrip, AttachmentUploadButton } from './attachments';
import { EvidenceStage } from './EvidenceStage';
import { MobileRegionNotes } from './RegionNotes';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    display: flex;
    flex: 1;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  /** The one scroll on the page — image on top, the notes it earns below it. */
  scroll: css`
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    min-height: 0;
    padding-block-end: 12px;
  `,
  /** The image keeps a fixed slice of the screen so the notes under it are
      reachable without a second screen — but stays tall enough to circle on. */
  stage: css`
    display: flex;
    flex: none;
    height: 42dvh;
    min-height: 220px;
  `,
  editor: css`
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 16px;

    padding-block-start: 4px;

    textarea {
      font-size: 16px;
    }
  `,
  footer: css`
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;

    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    > button {
      min-height: 44px;
    }
  `,
}));

/**
 * Phone review on one page: look at the image, circle what is wrong, and write
 * the note right where the circle landed.
 */
export const MobileEvidenceReview = memo<{ model: RejectReviewModel }>(({ model }) => {
  const { t } = useTranslation('verify');
  const {
    activeAnnotations,
    activeEvidence,
    activeIndex,
    annotations,
    attachments,
    canSubmit,
    canvas,
    comment,
    drawing,
    evidence,
    failed,
    handlePaste,
    loading,
    uploading,
    zoom,
  } = model;

  return (
    <div className={styles.body}>
      <div className={styles.scroll}>
        {activeEvidence && (
          <>
            <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
              <ActionIcon
                aria-label={t('acceptance.review.previousImage')}
                disabled={activeIndex <= 0}
                icon={ChevronLeft}
                size={{ blockSize: 44, size: 20 }}
                onClick={() => model.selectEvidence(activeIndex - 1)}
              />
              <Text aria-live={'polite'} style={{ flex: 1, textAlign: 'center' }}>
                {t('acceptance.review.imageNumber', {
                  current: activeIndex + 1,
                  total: evidence.length,
                })}
              </Text>
              <ActionIcon
                aria-label={t('acceptance.review.nextImage')}
                disabled={activeIndex >= evidence.length - 1}
                icon={ChevronRight}
                size={{ blockSize: 44, size: 20 }}
                onClick={() => model.selectEvidence(activeIndex + 1)}
              />
            </Flexbox>
            <div className={styles.stage}>
              <EvidenceStage
                touch
                annotations={activeAnnotations}
                drawing={drawing}
                src={activeEvidence.fileUrl}
                zoom={zoom}
                onDraw={canvas.onDraw}
                onRemove={canvas.onRemove}
                onSwipe={(direction) => model.selectEvidence(activeIndex + direction)}
                onUpdate={canvas.onUpdate}
              />
            </div>
            <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
              {/* A mode switch, not an action button. A single button labelled
                  with the mode it would LEAVE says nothing about which mode is
                  on, and its 44px slab sat oddly beside the small zoom icons. */}
              <Segmented
                size={'small'}
                value={drawing ? 'draw' : 'browse'}
                options={[
                  { label: t('acceptance.review.browseImage'), value: 'browse' },
                  { label: t('acceptance.review.drawRegion'), value: 'draw' },
                ]}
                onChange={(value) => {
                  if ((value === 'draw') !== drawing) model.advance('toggle-draw');
                }}
              />
              <Flexbox flex={1} />
              <ActionIcon
                aria-label={t('acceptance.review.zoomOut')}
                disabled={zoom <= ZOOM_STEPS[0]}
                icon={ZoomOut}
                size={{ blockSize: 44, size: 20 }}
                onClick={() => model.stepZoom(-1)}
              />
              <Text fontSize={12}>{Math.round(zoom * 100)}%</Text>
              <ActionIcon
                aria-label={t('acceptance.review.zoomIn')}
                disabled={zoom >= ZOOM_STEPS.at(-1)!}
                icon={ZoomIn}
                size={{ blockSize: 44, size: 20 }}
                onClick={() => model.stepZoom(1)}
              />
            </Flexbox>
            {/* The hint is the region's receipt: it says the box landed AND
                that it is still editable, right above the note it belongs to. */}
            <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {drawing && activeAnnotations.length > 0
                ? t('acceptance.review.mobileDrawnHint', { count: activeAnnotations.length })
                : t(
                    drawing
                      ? 'acceptance.review.mobileDrawHint'
                      : 'acceptance.review.mobileBrowseHint',
                  )}
            </Text>
          </>
        )}
        <div className={styles.editor}>
          {annotations.length > 0 && (
            <>
              <Text strong>{t('acceptance.review.regionComments')}</Text>
              <MobileRegionNotes
                annotations={annotations}
                evidence={evidence}
                onChange={model.editAnnotation}
                onJump={model.jumpToRegion}
                onRemove={model.removeAnnotation}
              />
            </>
          )}
          <Text strong>{t('acceptance.review.supplement')}</Text>
          <TextArea
            aria-label={t('acceptance.review.supplement')}
            autoSize={{ maxRows: 10, minRows: 4 }}
            placeholder={t('acceptance.review.rejectPlaceholder')}
            style={{ fontSize: 16 }}
            value={comment}
            onChange={(event) => model.setComment(event.target.value)}
            onPaste={handlePaste}
          />
          <AttachmentUploadButton disabled={loading} onFiles={model.uploadFiles} />
          <AttachmentStrip
            attachments={attachments}
            disabled={loading}
            uploading={uploading}
            onRemove={model.removeAttachment}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('acceptance.review.draftSaved')}
          </Text>
        </div>
      </div>
      <div className={styles.footer}>
        {failed && (
          <Text role={'alert'} type={'danger'}>
            {t('acceptance.review.submitFailed')}
          </Text>
        )}
        <Button
          disabled={!canSubmit}
          loading={loading}
          type={'primary'}
          onClick={model.submitReject}
        >
          {t('acceptance.review.confirmReject')}
        </Button>
      </div>
    </div>
  );
});

MobileEvidenceReview.displayName = 'AcceptanceMobileEvidenceReview';

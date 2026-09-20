'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, NotebookPen, PencilLine, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useState } from 'react';
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
  /** The image is what the reviewer came to look at, so it takes every pixel
      the rows below it do not need. When the notes open underneath, it yields
      down to a floor that still leaves room to circle on, then the page scrolls. */
  stage: css`
    display: flex;
    flex: 1 1 auto;
    min-height: 40dvh;
  `,
  /** Two equal thumb-sized buttons: what to do next with the image, and where
      the written note goes. */
  actions: css`
    display: flex;
    flex: none;
    gap: 8px;

    > button {
      flex: 1;
      min-height: 44px;
    }
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
 *
 * Marking is a mode of its own. While it is on, everything under the image is
 * about the regions — the list of circled comments and a Done button — so the
 * reviewer is never asked to type a general note or submit halfway through a
 * drag. Leaving the mode brings back the two-button row and the submit.
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

  // The supplement stays closed until asked for — the reject's substance is the
  // marked regions, and the phone should not scroll past an empty textarea to
  // reach the submit button. It opens itself when there is already text or
  // screenshots to show (a restored draft, a paste, prior feedback) — hidden
  // content the user cannot see is feedback waiting to be lost. Marked regions
  // stay out of this: they have their own region-comments section.
  const [supplementExpanded, setSupplementExpanded] = useState(() =>
    Boolean(comment.trim() || attachments.length > 0),
  );
  const hasSupplementContent = comment.trim().length > 0 || attachments.length > 0;
  const hasRegionContent = annotations.length > 0;

  const regionNotes = (
    <>
      <Text strong>{t('acceptance.review.regionComments')}</Text>
      {hasRegionContent ? (
        <MobileRegionNotes
          annotations={annotations}
          evidence={evidence}
          onChange={model.editAnnotation}
          onJump={model.jumpToRegion}
          onRemove={model.removeAnnotation}
        />
      ) : (
        <Text fontSize={13} type={'secondary'}>
          {t('acceptance.review.mobileRegionCommentsEmpty')}
        </Text>
      )}
    </>
  );

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
              {/* The hint is the region's receipt: it says the box landed AND
                  that it is still editable. It shares the zoom row so the
                  image above keeps the height a row of its own would cost. */}
              <Text fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
                {drawing && activeAnnotations.length > 0
                  ? t('acceptance.review.mobileDrawnHint', { count: activeAnnotations.length })
                  : t(
                      drawing
                        ? 'acceptance.review.mobileDrawHint'
                        : 'acceptance.review.mobileBrowseHint',
                    )}
              </Text>
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
          </>
        )}
        {drawing ? (
          // Marking mode: the circled comments are the whole story below the
          // image — each new box lands here, ready for its note.
          <div className={styles.editor}>{regionNotes}</div>
        ) : (
          <>
            {/* Two buttons side by side: one enters marking mode, the other
                discloses the written note below. The open state is a light
                fill, not the primary slab — it marks which panel is open, it
                is not the page's action. */}
            <div className={styles.actions}>
              {activeEvidence && (
                <Button icon={PencilLine} onClick={() => model.advance('toggle-draw')}>
                  {t('acceptance.review.drawRegion')}
                </Button>
              )}
              <Button
                aria-expanded={supplementExpanded}
                icon={NotebookPen}
                type={supplementExpanded ? 'fill' : 'default'}
                onClick={() => setSupplementExpanded((open) => !open)}
              >
                {hasSupplementContent && !supplementExpanded
                  ? t('acceptance.review.supplementButtonDraft')
                  : t('acceptance.review.supplementButton')}
              </Button>
            </div>
            {(hasRegionContent || supplementExpanded) && (
              <div className={styles.editor}>
                {hasRegionContent && regionNotes}
                {supplementExpanded && (
                  <>
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
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className={styles.footer}>
        {drawing ? (
          // Done closes marking mode; the boxes and their notes stay. The
          // submit only comes back once the reviewer is out of the mode.
          <Button type={'primary'} onClick={() => model.advance('toggle-draw')}>
            {t('acceptance.review.confirmRegions')}
          </Button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
});

MobileEvidenceReview.displayName = 'AcceptanceMobileEvidenceReview';

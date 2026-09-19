'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Segmented, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
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
  /** The fold header: the whole row is the tap target (44px touch minimum),
      not just the chevron. The chevron's rotation carries the open state. */
  toggle: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-height: 44px;
    padding: 0;
    border: none;

    text-align: start;

    background: none;

    &:active {
      opacity: 0.7;
    }
  `,
  toggleChevron: css`
    transform: rotate(0deg);
    flex: none;
    color: ${cssVar.colorTextTertiary};
    transition: transform 150ms ease-out;

    [data-expanded='true'] & {
      transform: rotate(180deg);
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

  // The supplement block folds away by default — the reject's substance is the
  // marked regions, and the phone should not scroll past an empty textarea to
  // reach the submit button. It opens itself when there is already text or
  // screenshots to show (a restored draft, a paste, prior feedback) — folded
  // content the user cannot see is feedback waiting to be lost. Marked regions
  // stay out of this: they have their own region-comments section above.
  const [supplementExpanded, setSupplementExpanded] = useState(() =>
    Boolean(comment.trim() || attachments.length > 0),
  );
  const hasSupplementContent = comment.trim().length > 0 || attachments.length > 0;
  const hasRegionContent = annotations.length > 0;

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
          {hasRegionContent && (
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
          {/* The supplement fold: the header is a real button (state is
              perceivable and reachable by assistive tech), the summary tells
              the folded reader what is already inside — an empty "optional"
              block that silently holds typed words is how feedback gets lost. */}
          <button
            aria-expanded={supplementExpanded}
            className={styles.toggle}
            data-expanded={supplementExpanded}
            type={'button'}
            onClick={() => setSupplementExpanded((open) => !open)}
          >
            <Text strong>{t('acceptance.review.supplement')}</Text>
            {!supplementExpanded && (
              <Text fontSize={12} type={'secondary'}>
                {hasSupplementContent
                  ? t('acceptance.review.supplementFoldedDraft')
                  : t('acceptance.review.supplementFoldedEmpty')}
              </Text>
            )}
            <ChevronDown className={styles.toggleChevron} size={16} />
          </button>
          {supplementExpanded && (
            <>
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

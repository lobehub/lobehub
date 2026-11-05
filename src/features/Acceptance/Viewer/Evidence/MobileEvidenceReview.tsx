'use client';

import { ActionIcon, Button, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight, NotebookPen, PencilLine, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ZOOM_STEPS } from '../Review/rejectDraft';
import type { RejectReviewModel } from '../Review/useRejectReview';
import { AttachmentStrip, AttachmentUploadButton } from './attachments';
import { EvidenceStage } from './EvidenceStage';
import { MobileRegionNotes } from './RegionNotes';

const styles = stylex.create({
  body: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
  },
  // The one scroll on the page — image on top, the notes it earns below it.
  scroll: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '8px',
    minHeight: 0,
    paddingBlockEnd: '12px',
  },
  // The image is what the reviewer came to look at, so it takes every pixel
  // the rows below it do not need. When the notes open underneath, it yields
  // down to a floor that still leaves room to circle on, then the page scrolls.
  stage: {
    display: 'flex',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    minHeight: '40dvh',
  },
  // One full-width control under the image: the image arrows at the two
  // edges where a thumb lands, the zoom (minus, percentage, plus) between
  // them. Two fingers set the zoom too; the buttons show where it landed.
  switcher: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    width: '100%',
    minHeight: '44px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  zoom: {
    display: 'flex',
    flex: '1',
    gap: '4px',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Two equal thumb-sized buttons: what to do next with the image, and where
  // the written note goes.
  actions: {
    display: 'flex',
    flex: 'none',
    gap: '8px',
  },
  actionButton: {
    flex: '1',
    minHeight: '44px',
  },
  editor: {
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
    gap: '16px',
    paddingBlockStart: '4px',
  },
  footer: {
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
    gap: '8px',
    paddingBlockStart: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  footerButton: {
    minHeight: '44px',
  },
});

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
    // Only what this phone can edit — videos' notes are kept in the model and
    // submitted untouched, but have no stage here to point back to.
    editableAnnotations: annotations,
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
    <div {...stylex.props(styles.body)}>
      <div {...stylex.props(styles.scroll)}>
        {activeEvidence && (
          <>
            <div {...stylex.props(styles.stage)}>
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
                onZoom={model.setZoom}
              />
            </div>
            {/* One full-width block under the stage: previous / next at the
                edges, the zoom in the middle. No hint text — the phone shows,
                it does not explain. The percentage is what a pinch landed on;
                the buttons step from there to the next notch. */}
            <div {...stylex.props(styles.switcher)}>
              <ActionIcon
                aria-label={t('acceptance.review.previousImage')}
                disabled={activeIndex <= 0}
                icon={ChevronLeft}
                size={{ blockSize: 44, size: 20 }}
                onClick={() => model.selectEvidence(activeIndex - 1)}
              />
              <div {...stylex.props(styles.zoom)}>
                <ActionIcon
                  aria-label={t('acceptance.review.zoomOut')}
                  disabled={zoom <= ZOOM_STEPS[0]}
                  icon={ZoomOut}
                  size={{ blockSize: 44, size: 20 }}
                  onClick={() => model.stepZoom(-1)}
                />
                <Text
                  aria-live={'polite'}
                  fontSize={13}
                  style={{ minWidth: 44, textAlign: 'center' }}
                >
                  {Math.round(zoom * 100)}%
                </Text>
                <ActionIcon
                  aria-label={t('acceptance.review.zoomIn')}
                  disabled={zoom >= ZOOM_STEPS.at(-1)!}
                  icon={ZoomIn}
                  size={{ blockSize: 44, size: 20 }}
                  onClick={() => model.stepZoom(1)}
                />
              </div>
              <ActionIcon
                aria-label={t('acceptance.review.nextImage')}
                disabled={activeIndex >= evidence.length - 1}
                icon={ChevronRight}
                size={{ blockSize: 44, size: 20 }}
                onClick={() => model.selectEvidence(activeIndex + 1)}
              />
            </div>
          </>
        )}
        {drawing ? (
          // Marking mode: the circled comments are the whole story below the
          // image — each new box lands here, ready for its note.
          <div {...stylex.props(styles.editor)}>{regionNotes}</div>
        ) : (
          <>
            {/* Two buttons side by side: one enters marking mode, the other
                discloses the written note below. The open state is a light
                fill, not the primary slab — it marks which panel is open, it
                is not the page's action. */}
            <div {...stylex.props(styles.actions)}>
              {activeEvidence && (
                <Button
                  icon={PencilLine}
                  {...stylex.props(styles.actionButton)}
                  onClick={() => model.advance('toggle-draw')}
                >
                  {t('acceptance.review.drawRegion')}
                </Button>
              )}
              <Button
                aria-expanded={supplementExpanded}
                icon={NotebookPen}
                {...stylex.props(styles.actionButton)}
                type={supplementExpanded ? 'fill' : 'default'}
                onClick={() => setSupplementExpanded((open) => !open)}
              >
                {hasSupplementContent && !supplementExpanded
                  ? t('acceptance.review.supplementButtonDraft')
                  : t('acceptance.review.supplementButton')}
              </Button>
            </div>
            {(hasRegionContent || supplementExpanded) && (
              <div {...stylex.props(styles.editor)}>
                {hasRegionContent && regionNotes}
                {supplementExpanded && (
                  <>
                    <Text strong>{t('acceptance.review.supplement')}</Text>
                    <TextArea
                      aria-label={t('acceptance.review.supplement')}
                      autoSize={{ maxRows: 10, minRows: 4 }}
                      placeholder={t('acceptance.review.rejectPlaceholder')}
                      style={{ fontSize: 16 }}
                      styles={{ input: { fontSize: 16 } }}
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
      <div {...stylex.props(styles.footer)}>
        {drawing ? (
          // Done closes marking mode; the boxes and their notes stay. The
          // submit only comes back once the reviewer is out of the mode.
          <Button
            type={'primary'}
            {...stylex.props(styles.footerButton)}
            onClick={() => model.advance('toggle-draw')}
          >
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
              {...stylex.props(styles.footerButton)}
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

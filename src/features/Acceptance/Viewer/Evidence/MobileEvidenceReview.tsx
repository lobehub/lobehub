'use client';

import { ActionIcon, Button, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight, PencilLine, ZoomIn, ZoomOut } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ZOOM_STEPS } from '../Review/rejectDraft';
import type { RejectReviewModel } from '../Review/useRejectReview';
import { AttachmentStrip, AttachmentUploadButton } from './attachments';
import { EvidenceStage } from './EvidenceStage';
import { MobileRegionNotes } from './RegionNotes';

const TOUCH_ICON = { blockSize: 44, size: 20 };

const styles = stylex.create({
  body: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
  },
  // The modal shell already pads the content 12px inline; 4px more makes the
  // 16px column, and the footer's negative margin takes its rule edge to edge.
  scroll: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '12px',
    minHeight: 0,
    paddingBlock: '16px',
    paddingInline: '4px',
  },
  // A zero basis keeps the stage's height a matter of layout alone: the image
  // is fitted to the measured stage, so a content-sized stage would feed back.
  stage: {
    display: 'flex',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: '0px',
    minHeight: 'min(340px, 45dvh)',
  },
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
  counter: {
    flex: 'none',
    minWidth: '32px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flex: '1',
  },
  zoomValue: {
    flex: 'none',
    minWidth: '44px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorText,
    textAlign: 'center',
  },
  drawButton: {
    flex: 'none',
    width: '100%',
    minHeight: '44px',
  },
  section: {
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  regionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBlockStart: '8px',
  },
  regionEmpty: {
    marginBlockStart: '4px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  label: {
    marginBlockEnd: '4px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  caption: {
    marginBlockStart: '4px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
  attachments: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  footer: {
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
    gap: '8px',
    marginInline: '-12px',
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  footerButton: {
    width: '100%',
    minHeight: '44px',
  },
  alert: {
    fontSize: '12px',
    lineHeight: '20px',
  },
});

export const MobileEvidenceReview = memo<{ model: RejectReviewModel }>(({ model }) => {
  const { t } = useTranslation('verify');
  const {
    activeAnnotations,
    activeEvidence,
    activeIndex,
    // Videos' notes stay in the model and are submitted untouched; the phone
    // has no stage to point them back to, so it lists only what it can edit.
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

  const hasRegions = annotations.length > 0;
  const toggleDraw = () => model.advance('toggle-draw');

  const regionSection = (
    <div {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionTitle)}>{t('acceptance.review.regionComments')}</div>
      {hasRegions ? (
        <div {...stylex.props(styles.regionList)}>
          <MobileRegionNotes
            annotations={annotations}
            evidence={evidence}
            onChange={model.editAnnotation}
            onJump={model.jumpToRegion}
            onRemove={model.removeAnnotation}
          />
        </div>
      ) : (
        <div {...stylex.props(styles.regionEmpty)}>
          {t('acceptance.review.mobileRegionCommentsEmpty')}
        </div>
      )}
    </div>
  );

  return (
    <div {...stylex.props(styles.body)}>
      <div {...stylex.props(styles.scroll)}>
        {activeEvidence && (
          <>
            <div {...stylex.props(styles.stage)}>
              <EvidenceStage
                contain
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
            <div {...stylex.props(styles.switcher)}>
              <ActionIcon
                aria-label={t('acceptance.review.previousImage')}
                disabled={activeIndex <= 0}
                icon={ChevronLeft}
                size={TOUCH_ICON}
                onClick={() => model.selectEvidence(activeIndex - 1)}
              />
              <span
                {...stylex.props(styles.counter)}
                aria-label={t('acceptance.review.imageNumber', {
                  current: activeIndex + 1,
                  total: evidence.length,
                })}
              >
                {activeIndex + 1} / {evidence.length}
              </span>
              <ActionIcon
                aria-label={t('acceptance.review.nextImage')}
                disabled={activeIndex >= evidence.length - 1}
                icon={ChevronRight}
                size={TOUCH_ICON}
                onClick={() => model.selectEvidence(activeIndex + 1)}
              />
              <span {...stylex.props(styles.spacer)} />
              <ActionIcon
                aria-label={t('acceptance.review.zoomOut')}
                disabled={zoom <= ZOOM_STEPS[0]}
                icon={ZoomOut}
                size={TOUCH_ICON}
                onClick={() => model.stepZoom(-1)}
              />
              <span aria-live={'polite'} {...stylex.props(styles.zoomValue)}>
                {Math.round(zoom * 100)}%
              </span>
              <ActionIcon
                aria-label={t('acceptance.review.zoomIn')}
                disabled={zoom >= ZOOM_STEPS.at(-1)!}
                icon={ZoomIn}
                size={TOUCH_ICON}
                onClick={() => model.stepZoom(1)}
              />
            </div>
          </>
        )}
        {drawing ? (
          regionSection
        ) : (
          <>
            {activeEvidence && (
              <Button icon={PencilLine} {...stylex.props(styles.drawButton)} onClick={toggleDraw}>
                {t('acceptance.review.drawRegion')}
              </Button>
            )}
            {hasRegions && regionSection}
            <div {...stylex.props(styles.section)}>
              <div {...stylex.props(styles.label)}>{t('acceptance.review.supplement')}</div>
              {/* 16px: iOS Safari zooms the page when a focused field is smaller. */}
              <TextArea
                aria-label={t('acceptance.review.supplement')}
                autoSize={{ maxRows: 10, minRows: 3 }}
                placeholder={t('acceptance.review.rejectPlaceholder')}
                style={{ fontSize: 16 }}
                value={comment}
                variant={'filled'}
                onChange={(event) => model.setComment(event.target.value)}
                onPaste={handlePaste}
              />
              <div {...stylex.props(styles.caption)}>{t('acceptance.review.draftSaved')}</div>
              <div {...stylex.props(styles.attachments)}>
                <AttachmentUploadButton disabled={loading} onFiles={model.uploadFiles} />
                <AttachmentStrip
                  attachments={attachments}
                  disabled={loading}
                  uploading={uploading}
                  onRemove={model.removeAttachment}
                />
              </div>
            </div>
          </>
        )}
      </div>
      <div {...stylex.props(styles.footer)}>
        {drawing ? (
          <Button type={'primary'} {...stylex.props(styles.footerButton)} onClick={toggleDraw}>
            {t('acceptance.review.confirmRegions')}
          </Button>
        ) : (
          <>
            {failed && (
              <Text role={'alert'} type={'danger'} {...stylex.props(styles.alert)}>
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

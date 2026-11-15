'use client';

import { ActionIcon, Button, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Film, ZoomIn, ZoomOut } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ZOOM_STEPS } from '../Review/rejectDraft';
import type { RejectReviewModel } from '../Review/useRejectReview';
import { AttachmentStrip, AttachmentUploadButton } from './attachments';
import { EvidenceStage } from './EvidenceStage';
import { RegionNotes } from './RegionNotes';
import { VideoReviewStage } from './Video/VideoReviewStage';

const styles = stylex.create({
  body: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '12px',
    minHeight: 0,
  },
  footer: {
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
    gap: '8px',
    paddingBlockStart: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  strip: {
    overflowX: 'auto',
    display: 'flex',
    flex: 'none',
    gap: '8px',
  },
  // Stage and notes side by side — the pointer that circles a region is the
  // same one that types about it, so neither should scroll the other away.
  stageRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gridTemplateRows: 'minmax(0, 1fr)',
    flex: '1',
    gap: '16px',
    minHeight: 0,
  },
  stageCell: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
  },
  stageCellWide: {
    gridColumnStart: 1,
    gridColumnEnd: -1,
  },
  notes: {
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minWidth: 0,
    minHeight: 0,
  },
  thumb: {
    cursor: 'pointer',
    overflow: 'hidden',
    flex: 'none',
    width: '72px',
    aspectRatio: '16 / 10',
    padding: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusSM,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  thumbImage: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'top',
  },
  // A video has no poster to thumbnail without decoding it — an icon tile says what it is.
  videoThumb: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#fff',
    backgroundColor: '#000',
    backgroundImage: 'none',
  },
  thumbActive: {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: cssVar.colorPrimary,
    outlineOffset: '-2px',
  },
  // The zoom pill floats bottom-center over the stage — controls live with
  // the thing they control, not in a detached toolbar row.
  zoomBar: {
    position: 'absolute',
    zIndex: 5,
    insetBlockEnd: '16px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    height: '36px',
    paddingInline: '8px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  zoomLabel: {
    minWidth: '44px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorText,
    textAlign: 'center',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  attachments: {
    display: 'flex',
    flex: '1',
    gap: '8px',
    alignItems: 'center',
    minWidth: 0,
  },
});

interface DesktopEvidenceReviewProps {
  model: RejectReviewModel;
}

/**
 * Desktop reject: a wide stage with the region notes parked beside it, and the
 * delivery-wide note plus the decision in a footer that never scrolls away.
 */
export const DesktopEvidenceReview = memo<DesktopEvidenceReviewProps>(({ model }) => {
  const { t } = useTranslation('verify');
  const {
    activeAnnotations,
    activeEvidence,
    attachments,
    canSubmit,
    canvas,
    close,
    comment,
    evidence,
    failed,
    handlePaste,
    loading,
    uploading,
    zoom,
  } = model;
  const isVideo = activeEvidence?.type === 'video';

  return (
    <div {...stylex.props(styles.body)}>
      {activeEvidence && evidence.length > 1 && (
        <div {...stylex.props(styles.strip)}>
          {evidence.map((item, index) => (
            <button
              aria-pressed={item.id === activeEvidence.id}
              key={item.id}
              type={'button'}
              aria-label={t('acceptance.review.imageNumber', {
                current: index + 1,
                total: evidence.length,
              })}
              {...stylex.props(styles.thumb, item.id === activeEvidence.id && styles.thumbActive)}
              onClick={() => model.selectEvidence(index)}
            >
              {item.type === 'video' ? (
                <span {...stylex.props(styles.videoThumb)}>
                  <Icon icon={Film} size={18} />
                </span>
              ) : (
                <img alt={''} src={item.fileUrl} {...stylex.props(styles.thumbImage)} />
              )}
            </button>
          ))}
        </div>
      )}
      {activeEvidence && (
        <div {...stylex.props(styles.stageRow)}>
          <div {...stylex.props(styles.stageCell, isVideo && styles.stageCellWide)}>
            {isVideo ? (
              <VideoReviewStage
                activeNoteKey={model.activeNoteKey}
                chapters={activeEvidence.chapters ?? []}
                key={activeEvidence.id}
                notes={activeAnnotations}
                src={activeEvidence.fileUrl}
                onAddNote={model.addVideoNote}
                onChangeNote={model.editAnnotation}
                onRemoveNote={model.removeAnnotation}
                onSelectNote={model.setActiveNoteKey}
                onRefreshSource={
                  model.refreshEvidenceUrl
                    ? () => model.refreshEvidenceUrl!(activeEvidence.id)
                    : undefined
                }
              />
            ) : (
              <EvidenceStage
                contain
                drawing
                annotations={activeAnnotations}
                src={activeEvidence.fileUrl}
                zoom={zoom}
                controls={
                  <div {...stylex.props(styles.zoomBar)}>
                    <ActionIcon
                      disabled={zoom <= ZOOM_STEPS[0]}
                      icon={ZoomOut}
                      size={'small'}
                      title={t('acceptance.review.zoomOut')}
                      onClick={() => model.stepZoom(-1)}
                    />
                    <span {...stylex.props(styles.zoomLabel)}>{Math.round(zoom * 100)}%</span>
                    <ActionIcon
                      disabled={zoom >= ZOOM_STEPS.at(-1)!}
                      icon={ZoomIn}
                      size={'small'}
                      title={t('acceptance.review.zoomIn')}
                      onClick={() => model.stepZoom(1)}
                    />
                  </div>
                }
                onDraw={canvas.onDraw}
                onRemove={canvas.onRemove}
                onUpdate={canvas.onUpdate}
              />
            )}
          </div>
          {!isVideo && (
            <div {...stylex.props(styles.notes)}>
              <Flexbox>
                <Text strong>{t('acceptance.review.regionComments')}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('acceptance.review.annotateHint')}
                </Text>
              </Flexbox>
              <RegionNotes
                annotations={activeAnnotations}
                onChange={model.editAnnotation}
                onRemove={model.removeAnnotation}
              />
            </div>
          )}
        </div>
      )}
      <div {...stylex.props(styles.footer)}>
        {failed && (
          <Text role={'alert'} type={'danger'}>
            {t('acceptance.review.submitFailed')}
          </Text>
        )}
        <Text fontSize={12} type={'secondary'}>
          {t('acceptance.review.rejectFeedbackHint')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 5, minRows: 2 }}
          placeholder={t('acceptance.review.rejectPlaceholder')}
          value={comment}
          variant={'filled'}
          onChange={(event) => model.setComment(event.target.value)}
          onPaste={handlePaste}
        />
        <div {...stylex.props(styles.actions)}>
          <div {...stylex.props(styles.attachments)}>
            <AttachmentUploadButton disabled={loading} onFiles={model.uploadFiles} />
            <AttachmentStrip
              attachments={attachments}
              disabled={loading}
              uploading={uploading}
              onRemove={model.removeAttachment}
            />
          </div>
          <Button disabled={loading} type={'text'} onClick={close}>
            {t('acceptance.actions.cancel')}
          </Button>
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
    </div>
  );
});

DesktopEvidenceReview.displayName = 'AcceptanceDesktopEvidenceReview';

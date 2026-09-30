'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Film, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ZOOM_STEPS } from '../Review/rejectDraft';
import type { RejectReviewModel } from '../Review/useRejectReview';
import { AttachmentStrip, AttachmentUploadButton } from './attachments';
import { EvidenceStage } from './EvidenceStage';
import { RegionNotes } from './RegionNotes';
import { VideoNotes } from './Video/VideoNotes';
import type { VideoReviewStageHandle } from './Video/VideoReviewStage';
import { VideoReviewStage } from './Video/VideoReviewStage';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  footer: css`
    flex: none;
    padding-block-start: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  /** Stage and notes side by side — the pointer that circles a region is the
      same one that types about it, so neither should scroll the other away. */
  stageRow: css`
    display: flex;
    flex: 1;
    gap: 16px;
    min-height: 0;
  `,
  notes: css`
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
  /** A video has no poster to thumbnail without decoding it — an icon tile says what it is. */
  videoThumb: css`
    display: flex;
    align-items: center;
    justify-content: center;

    color: #fff;

    background: #000;
  `,
  thumbActive: css`
    border-color: ${cssVar.colorPrimary};
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
    hasEvidence,
    loading,
    uploading,
    zoom,
  } = model;
  const videoStage = useRef<VideoReviewStageHandle>(null);
  const isVideo = activeEvidence?.type === 'video';

  return (
    <div className={styles.body}>
      {activeEvidence && (
        <Flexbox flex={1} gap={12} style={{ minHeight: 0 }}>
          <Flexbox gap={12} height={'100%'} style={{ minHeight: 0 }}>
            {evidence.length > 1 && (
              <Flexbox horizontal gap={8} style={{ overflowX: 'auto', flex: 'none' }}>
                {evidence.map((item, index) => (
                  <button
                    aria-pressed={item.id === activeEvidence.id}
                    key={item.id}
                    style={{ flexShrink: 0 }}
                    type={'button'}
                    aria-label={t('acceptance.review.imageNumber', {
                      current: index + 1,
                      total: evidence.length,
                    })}
                    className={cx(
                      styles.thumb,
                      item.id === activeEvidence.id && styles.thumbActive,
                    )}
                    onClick={() => model.selectEvidence(index)}
                  >
                    {item.type === 'video' ? (
                      <span className={styles.videoThumb} style={{ height: '100%' }}>
                        <Icon icon={Film} size={18} />
                      </span>
                    ) : (
                      <img alt={''} src={item.fileUrl} />
                    )}
                  </button>
                ))}
              </Flexbox>
            )}
            <div className={styles.stageRow} style={{ position: 'relative' }}>
              {isVideo ? (
                <VideoReviewStage
                  activeNoteKey={model.activeNoteKey}
                  chapters={activeEvidence.chapters ?? []}
                  handleRef={videoStage}
                  key={activeEvidence.id}
                  notes={activeAnnotations}
                  src={activeEvidence.fileUrl}
                  onAddNote={model.addVideoNote}
                  onSelectNote={model.setActiveNoteKey}
                  onRefreshSource={
                    model.refreshEvidenceUrl
                      ? () => model.refreshEvidenceUrl!(activeEvidence.id)
                      : undefined
                  }
                />
              ) : (
                <EvidenceStage
                  drawing
                  annotations={activeAnnotations}
                  src={activeEvidence.fileUrl}
                  zoom={zoom}
                  onDraw={canvas.onDraw}
                  onRemove={canvas.onRemove}
                  onUpdate={canvas.onUpdate}
                />
              )}
              {!isVideo && (
                <div className={styles.zoomBar}>
                  <ActionIcon
                    disabled={zoom <= ZOOM_STEPS[0]}
                    icon={ZoomOut}
                    size={'small'}
                    title={t('acceptance.review.zoomOut')}
                    onClick={() => model.stepZoom(-1)}
                  />
                  <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
                  <ActionIcon
                    disabled={zoom >= ZOOM_STEPS.at(-1)!}
                    icon={ZoomIn}
                    size={'small'}
                    title={t('acceptance.review.zoomIn')}
                    onClick={() => model.stepZoom(1)}
                  />
                </div>
              )}
              <div className={styles.notes}>
                <Flexbox gap={2}>
                  <Text strong fontSize={13}>
                    {t('acceptance.review.regionComments')}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {isVideo
                      ? t('acceptance.video.annotateHint')
                      : t('acceptance.review.annotateHint')}
                  </Text>
                </Flexbox>
                {activeAnnotations.length === 0 && (
                  <Text fontSize={12} type={'secondary'}>
                    {isVideo
                      ? t('acceptance.video.notesEmpty')
                      : t('acceptance.review.regionCommentsEmpty')}
                  </Text>
                )}
                {isVideo ? (
                  <VideoNotes
                    activeNoteKey={model.activeNoteKey}
                    notes={activeAnnotations}
                    onChange={model.editAnnotation}
                    onFocusNote={(note) => videoStage.current?.focusNote(note)}
                    onRemove={model.removeAnnotation}
                  />
                ) : (
                  <RegionNotes
                    annotations={activeAnnotations}
                    onChange={model.editAnnotation}
                    onRemove={model.removeAnnotation}
                  />
                )}
              </div>
            </div>
          </Flexbox>
        </Flexbox>
      )}
      <div className={styles.footer}>
        {failed && (
          <Text role={'alert'} type={'danger'}>
            {t('acceptance.review.submitFailed')}
          </Text>
        )}
        <Flexbox gap={10} style={{ width: '100%' }}>
          <Text fontSize={12} type={'secondary'}>
            {/* The modal title already names the check; repeating it here reads as an echo. */}
            {hasEvidence
              ? t('acceptance.review.supplement')
              : t('acceptance.review.rejectFeedbackHint')}
          </Text>
          <TextArea
            autoSize={{ maxRows: 5, minRows: 2 }}
            placeholder={t('acceptance.review.rejectPlaceholder')}
            value={comment}
            onChange={(event) => model.setComment(event.target.value)}
            onPaste={handlePaste}
          />
          <Flexbox horizontal align={'flex-start'} gap={8}>
            <Flexbox horizontal flex={1} gap={8}>
              <AttachmentUploadButton disabled={loading} onFiles={model.uploadFiles} />
              <AttachmentStrip
                attachments={attachments}
                disabled={loading}
                uploading={uploading}
                onRemove={model.removeAttachment}
              />
            </Flexbox>
            <Button disabled={loading} onClick={close}>
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
          </Flexbox>
        </Flexbox>
      </div>
    </div>
  );
});

DesktopEvidenceReview.displayName = 'AcceptanceDesktopEvidenceReview';

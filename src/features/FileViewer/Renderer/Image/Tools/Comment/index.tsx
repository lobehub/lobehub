'use client';

import { nanoid } from '@lobechat/utils';
import { ActionIcon, Button, Text, TextArea } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ListIcon, Trash2Icon } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useImageStage } from '../../context';
import { imagePointToScreenFraction, type Point } from '../../geometry';
import { rectFromPoints } from '../Annotate/shapes';
import {
  anchorOrigin,
  describeAnchor,
  type ImageMarkup,
  MARKUP_COMMENT_MAX_LENGTH,
  type MarkupAnchor,
} from '../markup';
import MarkupPreview from '../MarkupPreview';
import SendToChatButton from '../SendToChatButton';
import { toolStyles } from '../styles';
import { useToolKeys } from '../useToolKeys';
import CommentMarkers, { markerStyles } from './CommentMarkers';

/** A drag shorter than this (in image fractions) is a click on a point. */
const REGION_MIN_SIZE = 0.02;

const styles = createStaticStyles(({ css }) => ({
  draft: css`
    position: absolute;
    z-index: 2;

    display: flex;
    flex-direction: column;
    gap: 6px;

    width: 240px;
    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: flex-start;

    padding: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover,
    &[data-active='true'] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  pinBadge: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 10px;

    font-size: 11px;
    font-weight: 600;
    color: #fff;

    background: ${cssVar.colorInfo};
  `,
}));

interface CommentModeProps {
  markup: ImageMarkup;
  onChange: (markup: ImageMarkup) => void;
  onExit: () => void;
  onSent: (sent: ImageMarkup) => void;
}

/**
 * Pin comments on a point of the image, or drag to comment on a region. They
 * stay in the viewer's memory until the user adds them to a chat message.
 * Anchors are normalized, so they stay on the same pixels through zoom and
 * rotation.
 */
const CommentMode = ({ markup, onChange, onExit, onSent }: CommentModeProps) => {
  const { t } = useTranslation('file');
  const { overlayElement, rotation, toImagePoint } = useImageStage();
  const { comments } = markup;

  const dragStart = useRef<Point | null>(null);
  const [dragAnchor, setDragAnchor] = useState<MarkupAnchor | null>(null);
  const [draftAnchor, setDraftAnchor] = useState<MarkupAnchor | null>(null);
  const [draftText, setDraftText] = useState('');
  const [activeId, setActiveId] = useState<string>();
  // In a narrow host (the resource detail dock) the list would cover the
  // image, so it starts collapsed there and opens from the bottom bar.
  const [listOpen, setListOpen] = useState(
    () => (overlayElement?.closest('[data-testid="image-viewer"]')?.clientWidth ?? 1024) >= 640,
  );

  const cancelDraft = () => {
    setDraftAnchor(null);
    setDraftText('');
  };

  useToolKeys({ onEscape: () => (draftAnchor ? cancelDraft() : onExit()) });

  const submitDraft = () => {
    const text = draftText.trim();
    if (!draftAnchor || !text) return;
    const id = nanoid();
    onChange({ ...markup, comments: [...comments, { anchor: draftAnchor, id, text }] });
    setActiveId(id);
    cancelDraft();
  };

  const removeComment = (id: string) =>
    onChange({ ...markup, comments: comments.filter((comment) => comment.id !== id) });

  const toAnchor = (start: Point, end: Point): MarkupAnchor => {
    const rect = rectFromPoints(start, end);
    return rect.width < REGION_MIN_SIZE && rect.height < REGION_MIN_SIZE
      ? { point: start, type: 'point' }
      : { rect, type: 'region' };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStart.current = point;
    setActiveId(undefined);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (point) setDragAnchor(toAnchor(start, point));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    setDragAnchor(null);
    if (!start) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY }) ?? start;
    setDraftAnchor(toAnchor(start, point));
  };

  const pendingAnchor = dragAnchor ?? draftAnchor;
  const draftOrigin = draftAnchor ? anchorOrigin(draftAnchor) : undefined;
  // Which way the draft card opens depends on where the point is on screen,
  // not in the image, once the image is turned.
  const draftScreen = draftOrigin ? imagePointToScreenFraction(draftOrigin, rotation) : undefined;

  return (
    <>
      <MarkupPreview shapes={markup.shapes} />
      {overlayElement &&
        createPortal(
          <div
            aria-label={t('imageViewer.comment.hint')}
            className={toolStyles.overlayFill}
            data-testid={'image-comment-layer'}
            style={{ cursor: 'crosshair', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              dragStart.current = null;
              setDragAnchor(null);
            }}
          >
            <CommentMarkers
              activeId={activeId}
              comments={comments}
              rotation={rotation}
              onSelect={setActiveId}
            />
            {pendingAnchor?.type === 'region' && (
              <span
                data-active
                className={markerStyles.region}
                style={{
                  height: `${pendingAnchor.rect.height * 100}%`,
                  left: `${pendingAnchor.rect.x * 100}%`,
                  top: `${pendingAnchor.rect.y * 100}%`,
                  width: `${pendingAnchor.rect.width * 100}%`,
                }}
              />
            )}
            {draftAnchor && draftOrigin && (
              <>
                <span
                  aria-hidden
                  data-active
                  className={markerStyles.pin}
                  style={{
                    left: `${draftOrigin.x * 100}%`,
                    top: `${draftOrigin.y * 100}%`,
                    transform: `rotate(${-rotation}deg)`,
                  }}
                >
                  {comments.length + 1}
                </span>
                <div
                  className={styles.draft}
                  data-testid={'image-comment-draft'}
                  style={{
                    left: `${draftOrigin.x * 100}%`,
                    top: `${draftOrigin.y * 100}%`,
                    transform: `rotate(${-rotation}deg) translate(${draftScreen && draftScreen.x > 0.6 ? 'calc(-100% - 16px)' : '16px'}, ${draftScreen && draftScreen.y > 0.6 ? '-100%' : '0'})`,
                    transformOrigin: '0 0',
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <TextArea
                    autoFocus
                    aria-label={t('imageViewer.comment.add')}
                    autoSize={{ maxRows: 6, minRows: 2 }}
                    maxLength={MARKUP_COMMENT_MAX_LENGTH}
                    placeholder={t('imageViewer.comment.placeholder')}
                    value={draftText}
                    onChange={(event) => setDraftText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        cancelDraft();
                      } else if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        submitDraft();
                      }
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button size={'small'} onClick={cancelDraft}>
                      {t('imageViewer.cancel')}
                    </Button>
                    <Button
                      disabled={!draftText.trim()}
                      size={'small'}
                      type={'primary'}
                      onClick={submitDraft}
                    >
                      {t('imageViewer.comment.post')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>,
          overlayElement,
        )}

      {listOpen && (
        <aside
          aria-label={t('imageViewer.comment.title')}
          className={toolStyles.panel}
          data-testid={'image-comment-panel'}
        >
          <div
            style={{
              alignItems: 'center',
              borderBottom: `1px solid ${cssVar.colorSplit}`,
              display: 'flex',
              fontWeight: 500,
              gap: 6,
              padding: '10px 12px',
            }}
          >
            <span>{t('imageViewer.comment.title')}</span>
            {comments.length > 0 && <Text type={'secondary'}>{comments.length}</Text>}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
            {comments.length === 0 ? (
              <Text style={{ display: 'block', padding: 12 }} type={'secondary'}>
                {t('imageViewer.comment.empty')}
              </Text>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {comments.map((comment, index) => (
                  <li
                    className={styles.item}
                    data-active={activeId === comment.id}
                    key={comment.id}
                    onClick={() => setActiveId(comment.id)}
                  >
                    <span className={styles.pinBadge}>{index + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {comment.text}
                      </div>
                      <Text style={{ fontSize: 12 }} type={'secondary'}>
                        {describeAnchor(comment.anchor, t)}
                      </Text>
                    </div>
                    <ActionIcon
                      aria-label={t('imageViewer.comment.delete')}
                      icon={Trash2Icon}
                      size={'small'}
                      title={t('imageViewer.comment.delete')}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeComment(comment.id);
                      }}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      )}

      <div className={toolStyles.dock}>
        <div aria-label={t('imageViewer.tool.comment')} className={toolStyles.bar} role={'toolbar'}>
          <span className={toolStyles.hint}>{t('imageViewer.comment.hint')}</span>
          <ActionIcon
            active={listOpen}
            aria-expanded={listOpen}
            aria-label={t('imageViewer.comment.title')}
            icon={ListIcon}
            size={'small'}
            title={t('imageViewer.comment.title')}
            onClick={() => setListOpen((value) => !value)}
          />
          <span className={toolStyles.divider} />
          <Button shape={'round'} size={'small'} onClick={onExit}>
            {t('imageViewer.done')}
          </Button>
          <SendToChatButton markup={markup} onSent={onSent} />
        </div>
      </div>
    </>
  );
};

export default CommentMode;

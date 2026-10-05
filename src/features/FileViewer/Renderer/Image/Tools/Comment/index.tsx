'use client';

import type { FileCommentAnchor } from '@lobechat/types';
import { FILE_COMMENT_MAX_LENGTH } from '@lobechat/types';
import { ActionIcon, Button, Spin, Text, TextArea, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ListIcon, Trash2Icon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useImageStage } from '../../context';
import { imagePointToScreenFraction } from '../../geometry';
import { toolStyles } from '../styles';
import { useToolKeys } from '../useToolKeys';
import { useFileComments } from './useFileComments';

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
  pin: css`
    cursor: pointer;

    position: absolute;
    z-index: 1;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    margin-block-start: -24px;
    margin-inline-start: -2px;
    padding: 0;
    border: 2px solid ${cssVar.colorBgContainer};
    border-radius: 12px 12px 12px 2px;

    font-size: 11px;
    font-weight: 600;
    color: #fff;

    background: ${cssVar.colorInfo};
    box-shadow: ${cssVar.boxShadowSecondary};

    &[data-active='true'] {
      background: ${cssVar.colorWarning};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
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
  onExit: () => void;
}

/**
 * Pin comments on a point of the image. Pins are stored as normalized
 * coordinates, so they stay on the same pixel through zoom and rotation.
 */
const CommentMode = ({ onExit }: CommentModeProps) => {
  const { t } = useTranslation('file');
  const { fileId, overlayElement, rotation, toImagePoint } = useImageStage();
  const {
    comments,
    createComment,
    creating,
    deleteComment,
    deletingIds,
    error,
    isLoading,
    reload,
  } = useFileComments(fileId);

  const [draftAnchor, setDraftAnchor] = useState<FileCommentAnchor | null>(null);
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

  const submitDraft = async () => {
    const content = draftText.trim();
    if (!draftAnchor || !content || creating) return;
    try {
      const comment = await createComment(draftAnchor, content);
      cancelDraft();
      if (comment) setActiveId(comment.id);
    } catch (error) {
      console.error('[ImageViewer] create comment failed', error);
      toast.error(t('imageViewer.comment.saveFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteComment(id);
    } catch (error) {
      console.error('[ImageViewer] delete comment failed', error);
      toast.error(t('imageViewer.comment.deleteFailed'));
    }
  };

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    setActiveId(undefined);
    setDraftAnchor(point);
  };

  // Which way the draft card opens depends on where the point is on screen,
  // not in the image, once the image is turned.
  const draftScreen = draftAnchor ? imagePointToScreenFraction(draftAnchor, rotation) : undefined;

  // Pins and the draft card sit inside the rotated frame; turning them back
  // keeps their labels upright.
  const upright = { transform: `rotate(${-rotation}deg)`, transformOrigin: '0 100%' };

  return (
    <>
      {overlayElement &&
        createPortal(
          <div
            aria-label={t('imageViewer.comment.hint')}
            className={toolStyles.overlayFill}
            data-testid={'image-comment-layer'}
            style={{ cursor: 'crosshair' }}
            onClick={handleOverlayClick}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {comments.map((comment, index) => (
              <button
                aria-label={t('imageViewer.comment.pin', { index: index + 1 })}
                className={styles.pin}
                data-active={activeId === comment.id}
                key={comment.id}
                title={comment.content}
                type={'button'}
                style={{
                  left: `${comment.anchor.x * 100}%`,
                  top: `${comment.anchor.y * 100}%`,
                  ...upright,
                }}
                onClick={() => setActiveId(comment.id)}
              >
                {index + 1}
              </button>
            ))}
            {draftAnchor && (
              <>
                <span
                  aria-hidden
                  data-active
                  className={styles.pin}
                  style={{
                    left: `${draftAnchor.x * 100}%`,
                    top: `${draftAnchor.y * 100}%`,
                    ...upright,
                  }}
                >
                  +
                </span>
                <div
                  className={styles.draft}
                  data-testid={'image-comment-draft'}
                  style={{
                    left: `${draftAnchor.x * 100}%`,
                    top: `${draftAnchor.y * 100}%`,
                    transform: `rotate(${-rotation}deg) translate(${draftScreen && draftScreen.x > 0.6 ? 'calc(-100% - 8px)' : '16px'}, ${draftScreen && draftScreen.y > 0.6 ? '-100%' : '0'})`,
                    transformOrigin: '0 0',
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <TextArea
                    autoFocus
                    aria-label={t('imageViewer.comment.add')}
                    autoSize={{ maxRows: 6, minRows: 2 }}
                    maxLength={FILE_COMMENT_MAX_LENGTH}
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
                        void submitDraft();
                      }
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button size={'small'} onClick={cancelDraft}>
                      {t('imageViewer.cancel')}
                    </Button>
                    <Button
                      disabled={!draftText.trim()}
                      loading={creating}
                      size={'small'}
                      type={'primary'}
                      onClick={() => void submitDraft()}
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
            {isLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                <Spin />
              </div>
            ) : error ? (
              <div
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 16,
                }}
              >
                <Text type={'secondary'}>{t('imageViewer.comment.loadFailed')}</Text>
                <Button size={'small'} onClick={() => void reload()}>
                  {t('imageViewer.retry')}
                </Button>
              </div>
            ) : comments.length === 0 ? (
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
                        {comment.content}
                      </div>
                      <Text style={{ fontSize: 12 }} type={'secondary'}>
                        {dayjs(comment.createdAt).format('YYYY-MM-DD HH:mm')}
                      </Text>
                    </div>
                    <ActionIcon
                      aria-label={t('imageViewer.comment.delete')}
                      icon={Trash2Icon}
                      loading={deletingIds.includes(comment.id)}
                      size={'small'}
                      title={t('imageViewer.comment.delete')}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(comment.id);
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
          <Button shape={'round'} size={'small'} type={'primary'} onClick={onExit}>
            {t('imageViewer.done')}
          </Button>
        </div>
      </div>
    </>
  );
};

export default CommentMode;

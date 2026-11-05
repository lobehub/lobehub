'use client';

import { ActionIcon, Badge } from '@lobehub/ui';
import {
  CropIcon,
  EraserIcon,
  MessageSquarePlusIcon,
  PencilLineIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { useImageStage } from '../context';
import AnnotateMode from './Annotate';
import BarButton from './BarButton';
import CommentMode from './Comment';
import { EMPTY_MARKUP, type ImageMarkup, isMarkupEmpty } from './markup';
import MarkupPreview from './MarkupPreview';
import ResizeMode from './Resize';
import SendToChatButton from './SendToChatButton';
import { toolStyles as styles } from './styles';

// AI editing pulls in the model and generation services; load it only when used.
const AIEditMode = lazy(() => import('./AIEdit'));

type ToolMode = 'annotate' | 'comment' | 'erase' | 'removeBackground' | 'resize';

/**
 * Editing tools for a persisted image file: the floating bottom toolbar and
 * the annotate / comment / remove background / erase / resize workflows it
 * opens. Mounted by hosts that show a real library file; each workflow
 * renders its own bar while active.
 *
 * Annotations and comments are not saved with the file. They are marks for a
 * follow-up chat message, kept in the viewer's memory per version (closing the
 * viewer drops them) until the user adds them to the chat input.
 */
const ImageEditTools = () => {
  const { t } = useTranslation('file');
  const { fitToScreen, markup, setMarkup } = useImageStage();
  const [mode, setMode] = useState<ToolMode | null>(null);
  // Every workflow ends in a new upload (file or chat attachment) or an image
  // generation, so members who cannot create content cannot start one.
  const { allowed: canCreate, reason } = usePermission('create_content');
  const { comments } = markup;

  const enter = (next: ToolMode) => {
    // Edits start from the whole image on screen, so pointer mapping is predictable.
    fitToScreen();
    setMode(next);
  };
  const exit = () => setMode(null);
  // Marks added while the handoff was uploading were not sent; keep them.
  const clearAfterSend = (sent: ImageMarkup) => {
    setMarkup((current) => (current === sent ? EMPTY_MARKUP : current));
    setMode(null);
  };

  const markupProps = { markup, onChange: setMarkup, onExit: exit, onSent: clearAfterSend };
  if (mode === 'annotate') return <AnnotateMode {...markupProps} />;
  if (mode === 'comment') return <CommentMode {...markupProps} />;
  if (mode === 'removeBackground' || mode === 'erase')
    return (
      <Suspense fallback={null}>
        <AIEditMode key={mode} operation={mode} onExit={exit} />
      </Suspense>
    );
  if (mode === 'resize') return <ResizeMode onExit={exit} />;

  const hasMarkup = !isMarkupEmpty(markup);

  return (
    <div className={styles.dock}>
      <MarkupPreview comments={markup.comments} shapes={markup.shapes} />
      <div
        aria-label={t('imageViewer.editTools')}
        className={styles.bar}
        data-testid={'image-edit-toolbar'}
        role={'toolbar'}
      >
        <BarButton
          disabled={!canCreate}
          icon={PencilLineIcon}
          label={t('imageViewer.tool.annotate')}
          title={reason}
          type={'text'}
          onClick={() => enter('annotate')}
        />
        <BarButton
          disabled={!canCreate}
          icon={MessageSquarePlusIcon}
          label={t('imageViewer.tool.comment')}
          title={reason}
          type={'text'}
          extra={
            comments.length > 0 && (
              <Badge
                aria-label={t('imageViewer.comment.count', { count: comments.length })}
                count={comments.length}
                size={'small'}
                style={{ marginInlineStart: 4 }}
              />
            )
          }
          onClick={() => enter('comment')}
        />
        <BarButton
          disabled={!canCreate}
          icon={WandSparklesIcon}
          label={t('imageViewer.tool.removeBackground')}
          title={reason}
          type={'text'}
          onClick={() => enter('removeBackground')}
        />
        <BarButton
          disabled={!canCreate}
          icon={EraserIcon}
          label={t('imageViewer.tool.erase')}
          title={reason}
          type={'text'}
          onClick={() => enter('erase')}
        />
        <BarButton
          disabled={!canCreate}
          icon={CropIcon}
          label={t('imageViewer.tool.resize')}
          title={reason}
          type={'text'}
          onClick={() => enter('resize')}
        />
        {hasMarkup && (
          <>
            <span className={styles.divider} />
            <ActionIcon
              aria-label={t('imageViewer.markup.discard')}
              icon={XIcon}
              size={'small'}
              title={t('imageViewer.markup.discard')}
              onClick={() => setMarkup(EMPTY_MARKUP)}
            />
            <SendToChatButton markup={markup} onSent={clearAfterSend} />
          </>
        )}
      </div>
    </div>
  );
};

export default ImageEditTools;

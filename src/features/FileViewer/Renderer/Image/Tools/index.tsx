'use client';

import { Badge, Button } from '@lobehub/ui/base-ui';
import {
  CropIcon,
  EraserIcon,
  MessageSquarePlusIcon,
  PencilLineIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useImageStage } from '../context';
import AnnotateMode from './Annotate';
import CommentMode from './Comment';
import { useFileComments } from './Comment/useFileComments';
import ResizeMode from './Resize';
import { toolStyles as styles } from './styles';

// AI editing pulls in the model and generation services; load it only when used.
const AIEditMode = lazy(() => import('./AIEdit'));

type ToolMode = 'annotate' | 'comment' | 'erase' | 'removeBackground' | 'resize';

/**
 * Editing tools for a persisted image file: the floating bottom toolbar and
 * the annotate / comment / remove background / erase / resize workflows it
 * opens. Mounted by hosts that
 * show a real library file; each workflow renders its own bar while active.
 */
const ImageEditTools = () => {
  const { t } = useTranslation('file');
  const { fileId, fitToScreen } = useImageStage();
  const [mode, setMode] = useState<ToolMode | null>(null);
  const { comments } = useFileComments(fileId);

  const enter = (next: ToolMode) => {
    // Edits start from the whole image on screen, so pointer mapping is predictable.
    fitToScreen();
    setMode(next);
  };
  const exit = () => setMode(null);

  if (mode === 'annotate') return <AnnotateMode onExit={exit} />;
  if (mode === 'comment') return <CommentMode onExit={exit} />;
  if (mode === 'removeBackground' || mode === 'erase')
    return (
      <Suspense fallback={null}>
        <AIEditMode key={mode} operation={mode} onExit={exit} />
      </Suspense>
    );
  if (mode === 'resize') return <ResizeMode onExit={exit} />;

  return (
    <div className={styles.dock}>
      <div
        aria-label={t('imageViewer.editTools')}
        className={styles.bar}
        data-testid={'image-edit-toolbar'}
        role={'toolbar'}
      >
        <Button
          icon={PencilLineIcon}
          shape={'round'}
          size={'small'}
          type={'text'}
          onClick={() => enter('annotate')}
        >
          {t('imageViewer.tool.annotate')}
        </Button>
        <Button
          icon={MessageSquarePlusIcon}
          shape={'round'}
          size={'small'}
          type={'text'}
          onClick={() => enter('comment')}
        >
          {t('imageViewer.tool.comment')}
          {comments.length > 0 && (
            <Badge
              aria-label={t('imageViewer.comment.count', { count: comments.length })}
              count={comments.length}
              size={'small'}
              style={{ marginInlineStart: 4 }}
            />
          )}
        </Button>
        <Button
          icon={WandSparklesIcon}
          shape={'round'}
          size={'small'}
          type={'text'}
          onClick={() => enter('removeBackground')}
        >
          {t('imageViewer.tool.removeBackground')}
        </Button>
        <Button
          icon={EraserIcon}
          shape={'round'}
          size={'small'}
          type={'text'}
          onClick={() => enter('erase')}
        >
          {t('imageViewer.tool.erase')}
        </Button>
        <Button
          icon={CropIcon}
          shape={'round'}
          size={'small'}
          type={'text'}
          onClick={() => enter('resize')}
        >
          {t('imageViewer.tool.resize')}
        </Button>
      </div>
    </div>
  );
};

export default ImageEditTools;

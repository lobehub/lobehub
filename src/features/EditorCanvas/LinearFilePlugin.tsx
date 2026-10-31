'use client';

import { FilePlugin, UploadPlugin, useLexicalComposerContext } from '@lobehub/editor';
import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { DownloadIcon } from 'lucide-react';
import {
  type FC,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { sx } from '@/styles/sx';
import { formatSize, formatSpeed, formatTime } from '@/utils/format';

import { preserveInsertedFileSize } from './editorAttachments';
import type { EditorFileUploadTracker } from './editorFileUploadTracker';
import { createEditorFileUploadTracker } from './editorFileUploadTracker';
import { openFileDownload } from './fileDownload';
import type { EditorAttachmentUpload } from './useImageUpload';

const styles = stylex.create({
  card: {
    cursor: 'pointer',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    boxSizing: 'border-box',
    width: '100%',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    transitionProperty: 'background',
    transitionDuration: cssVar.motionDurationMid,
  },
  download: {
    flexShrink: 0,
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    transitionProperty: 'opacity',
    transitionDuration: cssVar.motionDurationMid,
  },
  info: { overflow: 'hidden', flex: '1', minWidth: 0 },
  name: {
    overflow: 'hidden',
    fontSize: cssVar.fontSize,
    fontWeight: 500,
    lineHeight: 1.4,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  progress: {
    position: 'absolute',
    insetBlockEnd: 0,
    insetInlineStart: 0,
    height: '3px',
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
    transitionProperty: 'width',
    transitionDuration: cssVar.motionDurationMid,
    transitionTimingFunction: 'ease-out',
  },
  progressTrack: {
    position: 'absolute',
    insetBlockEnd: 0,
    insetInline: 0,
    height: '3px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  size: {
    marginBlockStart: '2px',
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.4,
    color: cssVar.colorTextTertiary,
  },
  state: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  uploadCard: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    boxSizing: 'border-box',
    width: '100%',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  uploadMeta: {
    overflow: 'hidden',
    marginBlockStart: '2px',
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.4,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface FileNodeLike {
  fileUrl?: string;
  getKey?: () => string;
  message?: string;
  name: string;
  size?: number;
  status?: 'pending' | 'uploaded' | 'error';
}

interface LinearFileCardProps {
  node: FileNodeLike;
  uploadTracker?: EditorFileUploadTracker;
}

const subscribeToNoUpload = () => () => {};

export const LinearFileCard = memo<LinearFileCardProps>(({ node, uploadTracker }) => {
  const { t } = useTranslation(['editor', 'file']);

  const { fileUrl, message, name, size, status } = node;
  const nodeKey = uploadTracker ? node.getKey?.() : undefined;
  const upload = useSyncExternalStore(
    uploadTracker && nodeKey !== undefined ? uploadTracker.subscribe : subscribeToNoUpload,
    () => (uploadTracker && nodeKey !== undefined ? uploadTracker.getSnapshot(nodeKey) : undefined),
    () => undefined,
  );

  useEffect(() => {
    if (!uploadTracker || nodeKey === undefined) return;

    if (status !== 'pending') {
      uploadTracker.releaseNode(nodeKey);
      return;
    }

    uploadTracker.bindNode(nodeKey, name);
    return () => uploadTracker.releaseNode(nodeKey);
  }, [name, nodeKey, status, uploadTracker]);

  if (status === 'pending') {
    const uploadState = upload?.uploadState;
    const rawProgress = Math.max(0, Math.min(100, uploadState?.progress || 0));
    const progress =
      upload?.status === 'uploading' ? Math.min(99, Math.round(rawProgress)) : rawProgress;
    const fileSize = upload?.file.size || size;
    const statusText =
      upload?.status === 'processing' || upload?.status === 'success'
        ? t('file.processing')
        : upload?.status === 'uploading'
          ? t('file.uploadingProgress', { progress })
          : t('file.preparing');
    const details = [
      fileSize
        ? uploadState
          ? `${formatSize(fileSize * (rawProgress / 100))} / ${formatSize(fileSize)}`
          : formatSize(fileSize)
        : undefined,
      upload?.status === 'uploading' && uploadState?.speed
        ? formatSpeed(uploadState.speed)
        : undefined,
      upload?.status === 'uploading' && uploadState?.restTime
        ? t('file:uploadDock.body.item.restTime', { time: formatTime(uploadState.restTime) })
        : undefined,
    ].filter(Boolean);

    return (
      <div {...stylex.props(styles.uploadCard)}>
        <FileIcon fileName={name} fileType={upload?.file.type} size={36} />
        <div {...stylex.props(styles.info)}>
          <div {...stylex.props(styles.name)}>{name}</div>
          <div {...stylex.props(styles.uploadMeta)}>
            {[statusText, ...details].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div
          aria-label={statusText}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          {...stylex.props(styles.progressTrack)}
          role="progressbar"
        >
          <div {...sx(styles.progress, undefined, { width: `${progress}%` })} />
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div {...stylex.props(styles.state)}>
        {t('file.error', { message: message || 'Unknown error' })}
      </div>
    );
  }

  const onDownloadClick = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.stopPropagation();
    event.preventDefault();
    if (!fileUrl) return;
    openFileDownload(fileUrl);
  };

  return (
    <div {...stylex.props(styles.card, stylex.defaultMarker())}>
      <FileIcon fileName={name} size={36} />
      <div {...stylex.props(styles.info)}>
        <div {...stylex.props(styles.name)}>{name}</div>
        {typeof size === 'number' && size > 0 ? (
          <div {...stylex.props(styles.size)}>{formatSize(size)}</div>
        ) : null}
      </div>
      <div {...stylex.props(styles.download)} data-lobehub-file-download="">
        <ActionIcon
          aria-label="Download"
          icon={DownloadIcon}
          size={'small'}
          variant={'filled'}
          onClick={onDownloadClick}
        />
      </div>
    </div>
  );
});

LinearFileCard.displayName = 'LinearFileCard';

interface LinearFilePluginProps {
  handleUpload: EditorAttachmentUpload;
  /**
   * Class applied to the outer Lexical `<span>` wrapper. Set to a block-level
   * style so the file card claims its own line in the paragraph.
   */
  theme?: { file?: string };
}

const LinearFilePlugin: FC<LinearFilePluginProps> = ({ handleUpload, theme }) => {
  const [editor] = useLexicalComposerContext();
  const uploadTrackerRef = useRef<EditorFileUploadTracker | null>(null);
  if (!uploadTrackerRef.current) uploadTrackerRef.current = createEditorFileUploadTracker();
  const uploadTracker = uploadTrackerRef.current;
  const trackedHandleUpload = useCallback<EditorAttachmentUpload>(
    async (file) => {
      preserveInsertedFileSize(file);
      const uploadId = uploadTracker.start(file);

      try {
        const result = await handleUpload(file, (status, uploadState) => {
          uploadTracker.update(uploadId, status, uploadState);
        });
        uploadTracker.finish(uploadId);
        return result;
      } catch (error) {
        uploadTracker.update(uploadId, 'error');
        uploadTracker.finish(uploadId);
        throw error;
      }
    },
    [handleUpload, uploadTracker],
  );

  useLayoutEffect(() => {
    editor.registerPlugin(UploadPlugin);
    editor.registerPlugin(FilePlugin, {
      decorator: (node) => <LinearFileCard node={node} uploadTracker={uploadTracker} />,
      handleUpload: trackedHandleUpload,
      theme,
    });
  }, [editor, trackedHandleUpload, theme, uploadTracker]);

  return null;
};

LinearFilePlugin.displayName = 'LinearFilePlugin';

export default LinearFilePlugin;

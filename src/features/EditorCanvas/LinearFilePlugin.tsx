'use client';

import { downloadFile } from '@lobechat/utils/client';
import { FilePlugin, UploadPlugin, useLexicalComposerContext } from '@lobehub/editor';
import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
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
import { formatSize, formatSpeed, formatTime } from '@/utils/format';

import type { EditorFileUploadTracker } from './editorFileUploadTracker';
import { createEditorFileUploadTracker } from './editorFileUploadTracker';
import type { EditorAttachmentUpload } from './useImageUpload';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    box-sizing: border-box;
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};

    transition: background ${cssVar.motionDurationMid};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:hover [data-lobehub-file-download] {
      opacity: 1;
    }
  `,
  download: css`
    flex-shrink: 0;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid};
  `,
  info: css`
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  name: css`
    overflow: hidden;

    font-size: ${cssVar.fontSize};
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  progress: css`
    position: absolute;
    inset-block-end: 0;
    inset-inline-start: 0;

    height: 3px;

    background: ${cssVar.colorPrimary};

    transition: width ${cssVar.motionDurationMid} ease-out;
  `,
  progressTrack: css`
    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;

    height: 3px;

    background: ${cssVar.colorFillSecondary};
  `,
  size: css`
    margin-block-start: 2px;
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
  `,
  state: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  uploadCard: css`
    position: relative;

    overflow: hidden;
    display: flex;
    gap: 12px;
    align-items: center;

    box-sizing: border-box;
    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
  uploadMeta: css`
    overflow: hidden;

    margin-block-start: 2px;

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
      <div className={styles.uploadCard}>
        <FileIcon fileName={name} fileType={upload?.file.type} size={36} />
        <div className={styles.info}>
          <div className={styles.name}>{name}</div>
          <div className={styles.uploadMeta}>
            {[statusText, ...details].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div
          aria-label={statusText}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className={styles.progressTrack}
          role="progressbar"
        >
          <div className={styles.progress} style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className={styles.state}>{t('file.error', { message: message || 'Unknown error' })}</div>
    );
  }

  const onDownloadClick = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.stopPropagation();
    event.preventDefault();
    if (!fileUrl) return;
    void downloadFile(fileUrl, name);
  };

  return (
    <div className={styles.card}>
      <FileIcon fileName={name} size={36} />
      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        {typeof size === 'number' && size > 0 ? (
          <div className={styles.size}>{formatSize(size)}</div>
        ) : null}
      </div>
      <div className={styles.download} data-lobehub-file-download="">
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

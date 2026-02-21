import { Button, Tooltip, stopPropagation } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';
import { formatSize } from '@/utils/format';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import ChunksBadge from '../../ListView/ListItem/ChunkTag';

const styles = createStaticStyles(({ css, cssVar }) => ({
  floatingChunkBadge: css`
    position: absolute;
    z-index: 3;
    inset-block-end: 8px;
    inset-inline-end: 8px;

    border-radius: ${cssVar.borderRadius};

    opacity: 0;
    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadow};

    transition: opacity ${cssVar.motionDurationMid};
  `,
  hoverOverlay: css`
    position: absolute;
    z-index: 1;
    inset: 0;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    padding: 16px;
    border-radius: ${cssVar.borderRadiusLG};

    opacity: 0;
    background: ${cssVar.colorBgMask};

    transition: opacity ${cssVar.motionDurationMid};

    &:hover {
      opacity: 1;
    }
  `,
  iconWrapper: css`
    display: flex;
    align-items: center;
    justify-content: center;

    height: 120px;
    margin-block-end: 12px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  markdownLoading: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 120px;
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  markdownPreview: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    min-height: 120px;
    max-height: 300px;
    padding: 16px;
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    word-wrap: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};

    &::after {
      pointer-events: none;
      content: '';

      position: absolute;
      inset-block-end: 0;
      inset-inline: 0;

      height: 60px;

      background: linear-gradient(to bottom, transparent, ${cssVar.colorFillQuaternary});
    }
  `,
  overlaySize: css`
    font-size: 12px;
    color: ${cssVar.colorTextLightSolid};
    opacity: 0.9;
  `,
  overlayTitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    max-width: 100%;
    margin-block-end: 8px;

    font-size: 14px;
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorTextLightSolid};
    text-align: center;
    word-break: break-word;
  `,
}));

interface MarkdownFileItemProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType?: string;
  finishEmbedding?: boolean;
  id: string;
  isLoadingMarkdown: boolean;
  markdownContent: string;
  name: string;
  size: number;
}

const MarkdownFileItem = memo<MarkdownFileItemProps>(
  ({
    chunkCount,
    chunkingError,
    chunkingStatus,
    embeddingError,
    embeddingStatus,
    fileType,
    finishEmbedding,
    id,
    isLoadingMarkdown,
    markdownContent,
    name,
    size,
  }) => {
    const { t } = useTranslation('components');
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = !isChunkingUnsupported(fileType || '');

    return (
      <>
        <div style={{ position: 'relative' }}>
          {isLoadingMarkdown ? (
            <div className={styles.markdownLoading}>Loading preview...</div>
          ) : markdownContent ? (
            <div className={styles.markdownPreview}>{markdownContent}</div>
          ) : (
            <div className={styles.iconWrapper}>
              <FileIcon fileName={name} fileType={fileType} size={64} />
            </div>
          )}
          {/* Hover overlay */}
          <div className={styles.hoverOverlay}>
            <div className={styles.overlayTitle}>{name}</div>
            <div className={styles.overlaySize}>{formatSize(size)}</div>
          </div>
        </div>
        {/* Floating chunk badge or action button */}
        {!isNull(chunkingStatus) && chunkingStatus ? (
          <div
            className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
            onClick={stopPropagation}
          >
            <ChunksBadge
              chunkCount={chunkCount}
              chunkingError={chunkingError}
              chunkingStatus={chunkingStatus}
              embeddingError={embeddingError}
              embeddingStatus={embeddingStatus}
              finishEmbedding={finishEmbedding}
              id={id}
            />
          </div>
        ) : (
          isSupportedForChunking && (
            <Tooltip title={t('FileManager.actions.chunkingTooltip')}>
              <div
                className={cx('floatingChunkBadge', styles.floatingChunkBadge)}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isCreatingFileParseTask) {
                    parseFiles([id]);
                  }
                }}
              >
                <Button
                  icon={FileBoxIcon}
                  loading={isCreatingFileParseTask}
                  size={'small'}
                  type={'text'}
                />
              </div>
            </Tooltip>
          )
        )}
      </>
    );
  },
);

export default MarkdownFileItem;

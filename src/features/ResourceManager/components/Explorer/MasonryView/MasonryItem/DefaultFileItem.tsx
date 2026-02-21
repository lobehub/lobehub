import { Button, Flexbox, Tooltip, stopPropagation } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon, Folder } from 'lucide-react';
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
  name: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin-block-end: 12px;

    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
    word-break: break-word;
  `,
}));

interface DefaultFileItemProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType?: string;
  finishEmbedding?: boolean;
  id: string;
  name: string;
  size: number;
}

const DefaultFileItem = memo<DefaultFileItemProps>(
  ({
    chunkCount,
    chunkingError,
    chunkingStatus,
    embeddingError,
    embeddingStatus,
    fileType,
    finishEmbedding,
    id,
    name,
    size,
  }) => {
    const { t } = useTranslation('components');
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isFolder = fileType === 'custom/folder';
    const isSupportedForChunking = !isChunkingUnsupported(fileType || '');

    return (
      <>
        <Flexbox
          align={'center'}
          gap={12}
          justify={'center'}
          paddingBlock={24}
          paddingInline={12}
          style={{ minHeight: 180 }}
        >
          {isFolder ? (
            <Folder size={64} strokeWidth={1.5} />
          ) : (
            <FileIcon fileName={name} fileType={fileType} size={64} />
          )}
          <div className={styles.name} style={{ textAlign: 'center' }}>
            {name}
          </div>
          {!isFolder && (
            <div
              style={{
                color: 'var(--lobe-chat-text-tertiary)',
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              {formatSize(size)}
            </div>
          )}
        </Flexbox>
        {/* Floating chunk badge or action button - only for files, not folders */}
        {!isFolder &&
          (!isNull(chunkingStatus) && chunkingStatus ? (
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
          ))}
      </>
    );
  },
);

export default DefaultFileItem;

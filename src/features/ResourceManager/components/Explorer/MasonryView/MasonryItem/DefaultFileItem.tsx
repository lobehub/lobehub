import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { Button, Flexbox, stopPropagation, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon, Folder } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { isChunkingSupported } from '@/libs/document-loaders/loaderType';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';
import { formatSize } from '@/utils/format';

import ChunksBadge from '../../ListView/ListItem/ChunkTag';

const styles = stylex.create({
  floatingChunkBadge: {
    position: 'absolute',
    zIndex: 3,
    insetBlockEnd: '8px',
    insetInlineEnd: '8px',
    borderRadius: cssVar.borderRadius,
    // Revealed by the card's hover (the card carries `stylex.defaultMarker()`).
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadow,
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  name: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    marginBlockEnd: '12px',
    fontWeight: cssVar.fontWeightStrong,
    color: cssVar.colorText,
    wordBreak: 'break-word',
  },
});

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

    const isFolder = fileType === CUSTOM_FOLDER_FILE_TYPE;
    const isSupportedForChunking = isChunkingSupported({ fileType, name });

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
          <div className={stylex.props(styles.name).className} style={{ textAlign: 'center' }}>
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
              className={stylex.props(styles.floatingChunkBadge).className}
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
                  className={stylex.props(styles.floatingChunkBadge).className}
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

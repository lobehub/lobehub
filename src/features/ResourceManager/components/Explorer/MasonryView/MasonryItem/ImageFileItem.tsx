import { Button, Flexbox, Tooltip, stopPropagation } from '@lobehub/ui';
import { Image } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import { memo, useState } from 'react';
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

    opacity: 0;
    background: ${cssVar.colorBgMask};

    transition: opacity ${cssVar.motionDurationMid};

    &:hover {
      opacity: 1;
    }
  `,
  imageWrapper: css`
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    min-height: 120px;

    background: ${cssVar.colorFillQuaternary};

    img {
      display: block;
      height: auto;
    }
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

interface ImageFileItemProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType?: string;
  finishEmbedding?: boolean;
  id: string;
  isInView: boolean;
  name: string;
  size: number;
  url?: string;
}

const ImageFileItem = memo<ImageFileItemProps>(
  ({
    chunkCount,
    chunkingError,
    chunkingStatus,
    embeddingError,
    embeddingStatus,
    fileType,
    finishEmbedding,
    id,
    isInView,
    name,
    size,
    url,
  }) => {
    const { t } = useTranslation('components');
    const [imageLoaded, setImageLoaded] = useState(false);
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = !isChunkingUnsupported(fileType || '');

    return (
      <>
        <div className={styles.imageWrapper}>
          {!imageLoaded && (
            <Flexbox
              align={'center'}
              gap={12}
              justify={'center'}
              paddingBlock={24}
              paddingInline={12}
            >
              <FileIcon fileName={name} fileType={fileType} size={48} />
              <div className={styles.name} style={{ textAlign: 'center' }}>
                {name}
              </div>
              <div
                style={{
                  color: 'var(--lobe-chat-text-tertiary)',
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                {formatSize(size)}
              </div>
            </Flexbox>
          )}
          {isInView && url && (
            <Image
              alt={name}
              loading="lazy"
              src={url}
              preview={{
                src: url,
              }}
              style={{
                display: 'block',
                height: 'auto',
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.3s',
                width: '100%',
              }}
              wrapperStyle={{
                inset: 0,
                pointerEvents: imageLoaded ? 'auto' : 'none',
                position: imageLoaded ? 'relative' : 'absolute',
                width: '100%',
              }}
              onError={() => setImageLoaded(false)}
              onLoad={() => setImageLoaded(true)}
            />
          )}
          {/* Hover overlay - only show when image is loaded */}
          {imageLoaded && (
            <div className={styles.hoverOverlay}>
              <div className={styles.overlayTitle}>{name}</div>
              <div className={styles.overlaySize}>{formatSize(size)}</div>
            </div>
          )}
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

export default ImageFileItem;

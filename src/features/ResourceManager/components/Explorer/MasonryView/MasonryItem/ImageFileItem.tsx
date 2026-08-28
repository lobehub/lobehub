import { Icon, stopPropagation, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Image } from 'antd';
import { createStaticStyles, cx, keyframes } from 'antd-style';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';
import { formatSize } from '@/utils/format';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import ChunksBadge from '../../ListView/ListItem/ChunkTag';
import { FALLBACK_ASPECT_RATIO, readAspectRatio } from './imageAspectRatio';
import { readPlaceholderIcon } from './placeholderIcon';

const pulse = keyframes`
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
`;

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

    container-type: size;
    overflow: hidden;

    width: 100%;

    background: ${cssVar.colorFillQuaternary};
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
  /**
   * Quiet stand-in for the bitmap: a tinted box with a muted glyph, not a
   * file-type badge — a thumbnail that hasn't arrived should read as "picture
   * on its way", not as a document card. A failure says so in words; a
   * crossed-out glyph alone leaves the viewer guessing what it is accusing the
   * file of.
   */
  placeholder: css`
    position: absolute;
    inset: 0;

    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    justify-content: center;

    padding-inline: 16px;

    color: ${cssVar.colorTextQuaternary};
  `,
  placeholderLoading: css`
    animation: ${pulse} 1.5s ease-in-out infinite;
  `,
  /**
   * One line only: the box is sized by the image's aspect ratio, so a wide, short
   * card has no room for a wrapping name — a second line gets clipped mid-glyph,
   * which looks more broken than the failure it is explaining.
   */
  placeholderName: css`
    overflow: hidden;

    max-width: 100%;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;

    @container (max-height: 92px) {
      display: none;
    }
  `,
  /**
   * The card's height is dictated by the image's aspect ratio, so a wide, short
   * box cannot hold the whole stack. Drop the decoration before the words: the
   * glyph goes first, the explanation is the last thing to leave.
   */
  placeholderIcon: css`
    @container (max-height: 56px) {
      display: none;
    }
  `,
  placeholderReason: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
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
  metadata?: Record<string, any> | null;
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
    metadata,
    name,
    size,
    url,
  }) => {
    const { t } = useTranslation('components');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const knownAspectRatio = readAspectRatio(metadata);
    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
    // Falls back to a reserved box until the bitmap reports its own ratio.
    const [aspectRatio, setAspectRatio] = useState(knownAspectRatio ?? FALLBACK_ASPECT_RATIO);
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = !isChunkingUnsupported(fileType || '');
    const imageLoaded = status === 'loaded';

    /**
     * Read the bitmap through the wrapper rather than the load event: antd's
     * `Image` renders the `<img>` inside its own wrapper, so the event's
     * `currentTarget` is not the image and `naturalWidth` reads back undefined.
     * Silently skipping the correction left every upload with no stored
     * dimensions parked on the fallback ratio — and `object-fit: cover` then
     * cropped the thumbnail to a box the image never had.
     */
    const applyNaturalRatio = () => {
      const img = wrapperRef.current?.querySelector('img');
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setAspectRatio(img.naturalWidth / img.naturalHeight);
      }
    };

    return (
      <>
        <div className={styles.imageWrapper} ref={wrapperRef} style={{ aspectRatio }}>
          {!imageLoaded && (
            <div
              className={cx(styles.placeholder, status === 'loading' && styles.placeholderLoading)}
            >
              <Icon
                className={styles.placeholderIcon}
                icon={readPlaceholderIcon(status)}
                size={28}
              />
              {status === 'error' && (
                <>
                  <div className={styles.placeholderReason}>
                    {t('FileManager.image.loadFailed')}
                  </div>
                  <div className={styles.placeholderName}>{name}</div>
                </>
              )}
            </div>
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
                height: '100%',
                objectFit: 'cover',
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.3s',
                width: '100%',
              }}
              wrapperStyle={{
                display: 'block',
                height: '100%',
                pointerEvents: imageLoaded ? 'auto' : 'none',
                width: '100%',
              }}
              onError={() => setStatus('error')}
              onLoad={() => {
                // Trust the bitmap over the stored metadata: a wrong stored
                // ratio would crop the thumbnail for good.
                applyNaturalRatio();
                setStatus('loaded');
              }}
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

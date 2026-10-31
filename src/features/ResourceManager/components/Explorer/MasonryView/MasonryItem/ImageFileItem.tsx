import { Button, Icon, Image, stopPropagation, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isChunkingSupported } from '@/libs/document-loaders/loaderType';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { sx } from '@/styles/sx';
import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';
import { formatSize } from '@/utils/format';

import ChunksBadge from '../../ListView/ListItem/ChunkTag';
import { FALLBACK_ASPECT_RATIO, readAspectRatio } from './imageAspectRatio';
import { readPlaceholderIcon } from './placeholderIcon';

const pulse = stylex.keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.5 },
});

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
  hoverOverlay: {
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    opacity: { 'default': 0, ':hover': 1 },
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  imageWrapper: {
    position: 'relative',
    containerType: 'size',
    overflow: 'hidden',
    width: '100%',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  overlaySize: {
    fontSize: '12px',
    color: cssVar.colorTextLightSolid,
    opacity: 0.9,
  },
  overlayTitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    maxWidth: '100%',
    marginBlockEnd: '8px',
    fontSize: '14px',
    fontWeight: cssVar.fontWeightStrong,
    color: cssVar.colorTextLightSolid,
    textAlign: 'center',
    wordBreak: 'break-word',
  },
  /**
   * Quiet stand-in for the bitmap: a tinted box with a muted glyph, not a
   * file-type badge — a thumbnail that hasn't arrived should read as "picture
   * on its way", not as a document card. A failure says so in words; a
   * crossed-out glyph alone leaves the viewer guessing what it is accusing the
   * file of.
   */
  placeholder: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: '16px',
    color: cssVar.colorTextQuaternary,
  },
  placeholderLoading: {
    animationName: pulse,
    animationDuration: '1.5s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  /**
   * One line only: the box is sized by the image's aspect ratio, so a wide, short
   * card has no room for a wrapping name — a second line gets clipped mid-glyph,
   * which looks more broken than the failure it is explaining.
   */
  placeholderName: {
    overflow: 'hidden',
    maxWidth: '100%',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'center',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: { 'default': null, '@container (max-height: 92px)': 'none' },
  },
  /**
   * The card's height is dictated by the image's aspect ratio, so a wide, short
   * box cannot hold the whole stack. Drop the decoration before the words: the
   * glyph goes first, the explanation is the last thing to leave.
   */
  placeholderIcon: {
    display: { 'default': null, '@container (max-height: 56px)': 'none' },
  },
  placeholderReason: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
});

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
    const knownAspectRatio = readAspectRatio(metadata);
    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
    // Falls back to a reserved box until the bitmap reports its own ratio.
    const [aspectRatio, setAspectRatio] = useState(knownAspectRatio ?? FALLBACK_ASPECT_RATIO);
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = isChunkingSupported({ fileType, name });
    const imageLoaded = status === 'loaded';

    return (
      <>
        <div {...sx([styles.imageWrapper], undefined, { aspectRatio })}>
          {!imageLoaded && (
            <div
              {...stylex.props(
                styles.placeholder,
                status === 'loading' && styles.placeholderLoading,
              )}
            >
              <Icon
                className={stylex.props(styles.placeholderIcon).className}
                icon={readPlaceholderIcon(status)}
                size={28}
              />
              {status === 'error' && (
                <>
                  <div {...stylex.props(styles.placeholderReason)}>
                    {t('FileManager.image.loadFailed')}
                  </div>
                  <div {...stylex.props(styles.placeholderName)}>{name}</div>
                </>
              )}
            </div>
          )}
          {isInView && url && (
            <Image
              alt={name}
              height={'100%'}
              objectFit={'cover'}
              preview={{ src: url }}
              src={url}
              variant={'borderless'}
              width={'100%'}
              style={{
                borderRadius: 0,
                height: '100%',
                pointerEvents: imageLoaded ? 'auto' : 'none',
                width: '100%',
              }}
              styles={{
                image: { opacity: imageLoaded ? 1 : 0, transition: 'opacity 0.3s' },
                wrapper: { height: '100%', width: '100%' },
              }}
              onError={() => setStatus('error')}
              onLoad={(e) => {
                const img = e.currentTarget;
                // After an error Image loads a fallback bitmap; that load must not count.
                if (img.getAttribute('src') !== url) return;
                // Trust the bitmap over the stored metadata: a wrong stored
                // ratio would crop the thumbnail for good.
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setAspectRatio(img.naturalWidth / img.naturalHeight);
                }
                setStatus('loaded');
              }}
            />
          )}
          {/* Hover overlay - only show when image is loaded */}
          {imageLoaded && (
            <div {...stylex.props(styles.hoverOverlay)}>
              <div {...stylex.props(styles.overlayTitle)}>{name}</div>
              <div {...stylex.props(styles.overlaySize)}>{formatSize(size)}</div>
            </div>
          )}
        </div>
        {/* Floating chunk badge or action button */}
        {!isNull(chunkingStatus) && chunkingStatus ? (
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
        )}
      </>
    );
  },
);

export default ImageFileItem;
